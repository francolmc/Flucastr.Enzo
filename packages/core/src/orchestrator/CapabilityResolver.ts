import { AvailableCapabilities, ResolvedAction, StepAction } from './types.js';
import { IntentAnalyzer } from './IntentAnalyzer.js';
import { extractJsonObjects, parseFirstJsonObject } from '../utils/StructuredJson.js';

export class CapabilityResolver {
  private intentAnalyzer: IntentAnalyzer | null = null;

  setIntentAnalyzer(analyzer: IntentAnalyzer): void {
    this.intentAnalyzer = analyzer;
  }

  async resolve(thought: string, available: AvailableCapabilities): Promise<ResolvedAction> {
    const resolvedFromJSON = this.resolveFromJSON(thought, available);
    if (resolvedFromJSON) {
      return resolvedFromJSON;
    }

    return this.resolveFromAI(thought, available);
  }

  private normalizeAction(parsed: any): any {
    const knownTools = ['execute_command', 'web_search', 'read_file', 'remember', 'write_file'];

    const inputObj = parsed.input ?? {};
    const parsedTool = typeof parsed.tool === 'string' ? parsed.tool.trim() : '';
    const parsedAction = typeof parsed.action === 'string' ? parsed.action.trim() : '';
    const explicitMcpTool =
      (parsedTool.startsWith('mcp_') && parsedTool) ||
      (parsedAction.startsWith('mcp_') && parsedAction) ||
      null;

    // Inferir tool desde combinación de parámetros (más preciso que mapeo 1:1)
    // IMPORTANTE: 'path' solo no es suficiente — read_file y write_file ambos usan 'path'
    // La presencia de 'content' distingue write_file de read_file
    let inferredTool: string | undefined;

    if ('command' in inputObj) {
      inferredTool = 'execute_command';
    } else if ('query' in inputObj) {
      inferredTool = 'web_search';
    } else if ('path' in inputObj && 'content' in inputObj) {
      inferredTool = 'write_file';
    } else if ('path' in inputObj) {
      inferredTool = 'read_file';
    } else if ('key' in inputObj || 'value' in inputObj) {
      inferredTool = 'remember';
    }

    // Determinar nombre de tool — prioridad:
    // 0. Si viene una tool MCP explícita, preservarla tal cual
    // 1. Campo "tool" del JSON si es válido (el modelo lo especificó explícitamente)
    // 2. Tool inferida desde el input (fallback para formatos incorrectos)
    // 3. Campo "action" si es nombre de tool conocida
    const toolName = explicitMcpTool
      ?? (knownTools.includes(parsed.tool) ? parsed.tool : null)
      ?? inferredTool
      ?? (knownTools.includes(parsed.action) ? parsed.action : null);

    if (!toolName || toolName === 'none') {
      return parsed;
    }

    // Si hay params fuera de input, moverlos adentro
    const finalInput: any = { ...inputObj };
    for (const key of Object.keys(parsed)) {
      if (!['action', 'tool', 'input', 'reasoning', 'reason'].includes(key)) {
        finalInput[key] = parsed[key];
      }
    }

    if (parsed.tool !== toolName) {
      console.log(`[CapabilityResolver] Normalized tool: "${parsed.tool ?? parsed.action}" → "${toolName}"`);
    }

    return { action: 'tool', tool: toolName, input: finalInput };
  }

  private resolveFromJSON(
    thought: string,
    available: AvailableCapabilities
  ): ResolvedAction | null {
    const jsonMatches = extractJsonObjects(thought);
    if (jsonMatches.length > 1) {
      console.warn(`[CapabilityResolver] Model emitted ${jsonMatches.length} JSONs in one response. Taking only the first one.`);
      console.warn(`[CapabilityResolver] Full thought:`, thought.substring(0, 300));
    }

    const parsedResult = parseFirstJsonObject<any>(thought, { tryRepair: true });
    if (parsedResult) {
      try {
        let parsed = parsedResult.value;
        // Normalize format B to format A if needed
        parsed = this.normalizeAction(parsed);
        
        // Check if JSON has the correct format
        if (!parsed.action) {
          console.warn(`[CapabilityResolver] JSON missing "action" field. Parsed:`, JSON.stringify(parsed).substring(0, 200));
          console.warn(`[CapabilityResolver] Full response:`, thought.substring(0, 300));
        } else if (parsed.action === 'tool' && parsed.tool) {
          const tool = available.tools.find(t => t.name === parsed.tool);
          if (tool) {
            return {
              type: 'tool',
              target: parsed.tool,
              reason: 'Tool requested by model',
              input: parsed.input ?? {},
            };
          }
          
          // Special case: if tool name starts with "mcp_", accept it even if not in available list
          // This allows MCP tools to be executed
          if (parsed.tool.startsWith('mcp_')) {
            return {
              type: 'tool',
              target: parsed.tool,
              reason: 'MCP Tool requested by model',
              input: parsed.input ?? {},
            };
          }
          
          console.warn(`[CapabilityResolver] Tool "${parsed.tool}" not found in available tools:`, available.tools.map(t => t.name));
        } else if (parsed.action === 'none') {
          return {
            type: 'none',
            target: '',
            reason: 'Model indicated sufficient information',
            input: '',
          };
        } else if (parsed.action === 'skill' && parsed.skill) {
          const normalizedSkill = String(parsed.skill).toLowerCase();
          const skill = available.skills.find(
            (s) =>
              s.name.toLowerCase() === normalizedSkill ||
              (s.id ? s.id.toLowerCase() === normalizedSkill : false)
          );
          if (skill) {
            return {
              type: 'skill',
              target: skill.id || skill.name,
              reason: 'Skill requested by model',
              input: parsed.input ?? {},
            };
          }
          
          // If skill not found, log and try to find a close match
          console.warn(`[CapabilityResolver] Skill "${parsed.skill}" not found in available skills:`, available.skills.map(s => s.name));
          
          // Try fuzzy matching - maybe the model meant a similar skill name
          const closeMatch = available.skills.find(s => 
            normalizedSkill.includes(s.name.toLowerCase()) ||
            s.name.toLowerCase().includes(normalizedSkill) ||
            (s.id ? normalizedSkill.includes(s.id.toLowerCase()) : false)
          );
          
          if (closeMatch) {
            console.warn(`[CapabilityResolver] Found similar skill "${closeMatch.name}", using that instead of "${parsed.skill}"`);
            return {
              type: 'skill',
              target: closeMatch.id || closeMatch.name,
              reason: `Model requested "${parsed.skill}", but using closest match "${closeMatch.name}"`,
              input: parsed.input ?? {},
            };
          }
        } else if (parsed.action === 'agent' && parsed.agent) {
          const agent = available.agents.find(a => a.id === parsed.agent);
          if (agent) {
            return {
              type: 'agent',
              target: parsed.agent,
              reason: 'Agent delegation requested by model',
              input: parsed.input ?? {},
            };
          }
        }
      } catch (e) {
        // JSON parse failed, fall back to AI-based intent analysis
      }
    }

    return null;
  }

  private async resolveFromAI(
    thought: string,
    available: AvailableCapabilities
  ): Promise<ResolvedAction> {
    // Use AI-based intent analysis if available
    if (this.intentAnalyzer) {
      try {
        const analysis = await this.intentAnalyzer.analyzeIntent(
          thought,
          available.tools,
          available.skills,
          available.agents,
          !!available.powerfulProvider
        );

        if (analysis.type === 'tool') {
          const toolInput =
            analysis.input && typeof analysis.input === 'object' && !Array.isArray(analysis.input)
              ? analysis.input
              : {};
          return {
            type: 'tool',
            target: analysis.target,
            reason: analysis.reason,
            input: toolInput,
          };
        } else if (analysis.type === 'skill') {
          return {
            type: 'skill',
            target: analysis.target,
            reason: analysis.reason,
            input: thought,
          };
        } else if (analysis.type === 'agent') {
          return {
            type: 'agent',
            target: analysis.target,
            reason: analysis.reason,
            input: thought,
          };
        } else if (analysis.type === 'escalate' && available.powerfulProvider) {
          return {
            type: 'escalate',
            target: available.powerfulProvider.name,
            reason: analysis.reason,
            input: thought,
          };
        } else if (analysis.type === 'none') {
          return {
            type: 'none',
            target: '',
            reason: analysis.reason,
            input: '',
          };
        }
      } catch (error) {
        console.error('IntentAnalyzer failed, falling back to default:', error);
      }
    }

    // Default: no action needed
    return {
      type: 'none',
      target: '',
      reason: 'No specific action required',
      input: '',
    };
  }
}
