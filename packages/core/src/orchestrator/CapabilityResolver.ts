import { AvailableCapabilities, DELEGATION_AGENT_IDS, ResolvedAction } from './types.js';
import { IntentAnalyzer } from './IntentAnalyzer.js';
import { extractJsonObjects, parseFirstJsonObject } from '../utils/StructuredJson.js';
import { foldDiacritics } from '../utils/foldDiacritics.js';

export { foldDiacritics };

export interface TriggerMatch {
  toolName: string;
  matched: string;
}

export class CapabilityResolver {
  private intentAnalyzer: IntentAnalyzer | null = null;

  setIntentAnalyzer(analyzer: IntentAnalyzer): void {
    this.intentAnalyzer = analyzer;
  }

  /**
   * Match the user's raw message against any tool's `triggers` phrases.
   * Comparison is case-insensitive and diacritic-insensitive. Returns the first hit or `null`.
   */
  resolveByTrigger(
    userMessage: string,
    executableTools: ReadonlyArray<{ name: string; triggers?: readonly string[] }>
  ): TriggerMatch | null {
    if (!userMessage) return null;
    const haystack = foldDiacritics(userMessage.toLowerCase());

    for (const tool of executableTools) {
      const triggers = tool.triggers;
      if (!triggers || triggers.length === 0) continue;
      for (const phrase of triggers) {
        if (!phrase) continue;
        const needle = foldDiacritics(phrase.toLowerCase()).trim();
        if (needle.length === 0) continue;
        if (haystack.includes(needle)) {
          return { toolName: tool.name, matched: phrase };
        }
      }
    }

    return null;
  }

  async resolve(thought: string, available: AvailableCapabilities): Promise<ResolvedAction> {
    const resolvedFromJSON = this.resolveFromJSON(thought, available);
    if (resolvedFromJSON) {
      return resolvedFromJSON;
    }

    return this.resolveFromAI(thought, available);
  }

  /**
   * Flatten shorthand JSON (params on root) and infer tool from parameter shape.
   * `availableToolNames` must list every tool the host registered (plus MCP names when present).
   */
  private normalizeAction(parsed: any, availableToolNames: string[]): any {
    if (parsed && typeof parsed.action === 'string' && String(parsed.action).trim() === 'delegate') {
      return parsed;
    }

    const nameSet = new Set(availableToolNames);
    const isAvailable = (n: string) => nameSet.has(n);

    const inputObj = parsed.input ?? {};
    const mergedInput: any = { ...inputObj };
    for (const key of Object.keys(parsed)) {
      if (!['action', 'tool', 'input', 'reasoning', 'reason'].includes(key)) {
        mergedInput[key] = parsed[key];
      }
    }

    const parsedTool = typeof parsed.tool === 'string' ? parsed.tool.trim() : '';
    const parsedAction = typeof parsed.action === 'string' ? parsed.action.trim() : '';
    const explicitMcpTool =
      (parsedTool.startsWith('mcp_') && parsedTool) ||
      (parsedAction.startsWith('mcp_') && parsedAction) ||
      null;

    let inferredTool: string | undefined;
    if ('command' in mergedInput) {
      inferredTool = 'execute_command';
    } else if ('query' in mergedInput) {
      inferredTool = 'web_search';
    } else if ('path' in mergedInput && 'content' in mergedInput) {
      inferredTool = 'write_file';
    } else if ('path' in mergedInput) {
      inferredTool = 'read_file';
    } else if ('key' in mergedInput || 'value' in mergedInput) {
      inferredTool = 'remember';
    }

    const inferred = inferredTool && isAvailable(inferredTool) ? inferredTool : undefined;

    const toolName = explicitMcpTool
      ?? (parsedTool && isAvailable(parsedTool) ? parsedTool : null)
      ?? inferred
      ?? (parsedAction && isAvailable(parsedAction) ? parsedAction : null);

    if (!toolName || toolName === 'none') {
      return parsed;
    }

    if (parsed.tool !== toolName && parsed.action !== toolName) {
      console.log(`[CapabilityResolver] Normalized tool: "${parsed.tool ?? parsed.action}" → "${toolName}"`);
    }

    return { action: 'tool', tool: toolName, input: mergedInput };
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

    const toolNames = available.tools.map((t) => t.name);
    const parsedResult = parseFirstJsonObject<any>(thought, { tryRepair: true });
    if (parsedResult) {
      try {
        let parsed = parsedResult.value;
        parsed = this.normalizeAction(parsed, toolNames);
        
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
        } else if (parsed.action === 'delegate') {
          const agent = typeof parsed.agent === 'string' ? parsed.agent.trim() : '';
          const task = typeof parsed.task === 'string' ? parsed.task.trim() : '';
          const modelReason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
          if (!agent || !task || !modelReason) {
            console.warn(
              `[CapabilityResolver] delegate action requires non-empty "agent", "task", and "reason". Got: ${JSON.stringify(
                { agent, taskLength: task.length, modelReason: modelReason ? 'ok' : 'missing' }
              )}`
            );
          } else if ((DELEGATION_AGENT_IDS as readonly string[]).includes(agent)) {
            return {
              type: 'delegate',
              target: agent,
              reason: modelReason,
              input: { task },
            };
          } else {
            console.warn(
              `[CapabilityResolver] delegate agent "${agent}" is not a supported delegation id: ${DELEGATION_AGENT_IDS.join(', ')}`
            );
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
