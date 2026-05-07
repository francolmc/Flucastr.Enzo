import { MCPRegistry } from '../mcp/index.js';
import { parseFirstJsonObject } from '../utils/StructuredJson.js';
import type { LLMProvider } from '../providers/types.js';

export interface RelevantMCP {
  id: string;
  name: string;
  description: string;
  serverId: string;
  relevanceScore: number;
  reasoning?: string;
}

interface MCPResolverOptions {
  llm: LLMProvider;
  withTimeout: <T>(promise: Promise<T>, ms: number, label: string) => Promise<T>;
}

export class MCPResolver {
  async resolveRelevantMCPs(
    message: string,
    mcpRegistry: MCPRegistry | undefined,
    options: MCPResolverOptions
  ): Promise<RelevantMCP[]> {
    if (!mcpRegistry) {
      console.log('[MCPResolver] No MCPRegistry provided');
      return [];
    }

    const allTools = mcpRegistry.getMCPToolsForOrchestrator();
    console.log(`[MCPResolver] Found ${allTools.length} MCP tools available`);
    if (allTools.length === 0) return [];

    const maxMCPs = this.resolveMaxMCPs();
    const preFiltered = this.preFilterByHeuristic(message, allTools);
    
    if (this.semanticSelectionEnabled()) {
      const llmSelected = await this.selectMCPsByLLM(message, allTools, maxMCPs, options);
      if (llmSelected && llmSelected.length > 0) {
        if (process.env.ENZO_DEBUG === 'true') {
          console.log('[MCPResolver] LLM selected MCPs:', llmSelected.map(m => m.id).join(', '));
        }
        return llmSelected;
      }
    }

    return preFiltered.slice(0, maxMCPs);
  }

  private resolveMaxMCPs(): number {
    const fromEnv = Number(process.env.ENZO_MCP_MAX_SELECTION ?? 3);
    if (Number.isNaN(fromEnv)) return 3;
    return Math.max(1, Math.min(fromEnv, 10));
  }

  private resolvePreFilterLimit(): number {
    const fromEnv = Number(process.env.ENZO_MCP_PRE_FILTER ?? 10);
    if (Number.isNaN(fromEnv)) return 10;
    return Math.max(1, Math.min(fromEnv, 20));
  }

  private semanticSelectionEnabled(): boolean {
    return (process.env.ENZO_MCP_LLM_SELECTION ?? 'true').toLowerCase() === 'true';
  }

  private preFilterByHeuristic(message: string, tools: any[]): RelevantMCP[] {
    const lowerMessage = message.toLowerCase();
    const scored = tools.map(tool => {
      const score = this.calculateRelevance(lowerMessage, tool);
      return {
        id: tool.name,
        name: tool.name,
        description: tool.description,
        serverId: tool.name.split('_')[1] || '',
        relevanceScore: score,
      };
    });

    const preFilterLimit = this.resolvePreFilterLimit();
    return scored
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, preFilterLimit);
  }

  private calculateRelevance(message: string, tool: any): number {
    const words = message.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const toolText = `${tool.name} ${tool.description}`.toLowerCase();
    
    if (words.length === 0) return 0.3;
    
    let matches = 0;
    for (const word of words) {
      if (toolText.includes(word)) {
        matches++;
      }
    }
    
    return Math.min(1, matches / words.length + 0.3);
  }

  private async selectMCPsByLLM(
    message: string,
    allTools: any[],
    maxMCPs: number,
    options: MCPResolverOptions
  ): Promise<RelevantMCP[] | null> {
    if (!options.llm || !options.withTimeout) return null;

    const catalog = allTools.map(t => ({
      id: t.name,
      name: t.name,
      description: t.description.slice(0, 500),
    }));

    const systemPrompt = `Eres un sistema de enrutamiento de herramientas MCP. Dado el mensaje del usuario y un catálogo de herramientas, selecciona la(s) más relevante(s) basándote en la descripción de cada herramienta.

IMPORTANTE: Si el usuario pide investigar, buscar información, últimas noticias, análisis web, etc → usa la herramienta con "research" o "simulate" en el nombre.
Si el usuario pide ver archivos, carpetas, leer documentos → usa herramientas con "file", "read", "directory", "list" en el nombre.

Responde con UN SOLO objeto JSON:
{"mcpIds":["id1","id2"],"reasoning":"explicación breve de por qué seleccionaste estos MCPs"}
Reglas:
- Incluye hasta ${maxMCPs} ids, más relevantes primero.
- Usa solo ids del catálogo.
- Si ninguna herramienta es relevante, usa {"mcpIds":[],"reasoning":"ninguna herramienta relevante"}.
- reasoning debe ser breve (máx 100 caracteres).
- No uses markdown. Solo el objeto JSON.`;

    const catalogJson = catalog.map(c => `- ${c.id}: ${c.name} - ${c.description}`).join('\n');

    const userPayload = [
      'MENSAJE DEL USUARIO:',
      message.slice(0, 4000),
      '',
      'CATÁLOGO DE HERRAMIENTAS MCP:',
      catalogJson,
    ].join('\n');

    try {
      const resp = await options.withTimeout(
        options.llm.complete({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPayload },
          ],
          temperature: 0.3,
          maxTokens: 256,
        }),
        60_000,
        'mcp-llm-selection'
      );

      const raw = resp.content ?? '';
      const parsed = parseFirstJsonObject<{ mcpIds?: unknown }>(raw, { tryRepair: true });

      const parsedObj = parsed?.value as { mcpIds?: unknown; reasoning?: unknown } | undefined;
      if (!parsedObj || !Array.isArray(parsedObj.mcpIds)) {
        if (process.env.ENZO_DEBUG === 'true') {
          console.warn('[MCPResolver] LLM selection failed: invalid JSON response');
        }
        return null;
      }

      const ids = (parsedObj.mcpIds ?? []).filter((x): x is string => typeof x === 'string');
      const reasoning = typeof parsedObj.reasoning === 'string' ? parsedObj.reasoning.slice(0, 100) : undefined;
      const byId = new Map(allTools.map(t => [t.name, {
        id: t.name,
        name: t.name,
        description: t.description,
        serverId: t.name.split('_')[1] || '',
        relevanceScore: 0.8,
      }]));

      const picked: RelevantMCP[] = [];
      const used = new Set<string>();

      for (const id of ids) {
        const m = byId.get(id);
        if (m && !used.has(id)) {
          used.add(id);
          picked.push({ ...m, relevanceScore: 1.0, reasoning });
        }
        if (picked.length >= maxMCPs) break;
      }

      if (picked.length === 0) {
        if (process.env.ENZO_DEBUG === 'true') {
          console.log('[MCPResolver] LLM returned no valid MCP ids, using heuristic fallback');
        }
        return null;
      }

      if (process.env.ENZO_DEBUG === 'true') {
        console.log(`[MCPResolver] Selection reasoning: ${reasoning}`);
      }

      return picked;
    } catch (err) {
      if (process.env.ENZO_DEBUG === 'true') {
        console.warn('[MCPResolver] LLM selection failed:', err);
      }
      return null;
    }
  }
}