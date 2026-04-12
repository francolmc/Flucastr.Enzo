import { LLMProvider, Message, Tool } from '../providers/types.js';
import { Skill, AgentConfig } from './types.js';
import { extractJsonObjects, parseFirstJsonObject } from '../utils/StructuredJson.js';

export interface IntentAnalysisResult {
  type: 'tool' | 'skill' | 'agent' | 'escalate' | 'none';
  target: string;
  reason: string;
  confidence: number;
  input?: Record<string, any>;
}

export class IntentAnalyzer {
  private provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  async analyzeIntent(
    thought: string,
    tools: Tool[],
    skills: Skill[],
    agents: AgentConfig[],
    needsEscalation: boolean = false
  ): Promise<IntentAnalysisResult> {
    const toolsList = tools.map(t => `- ${t.name}: ${t.description}`).join('\n');
    const skillsList = skills.map(s => `- ${s.name}: ${s.description}`).join('\n');
    const agentsList = agents.map(a => `- ${a.id} (${a.name}): ${a.description}`).join('\n');

    const systemPrompt = `You are an intent analyzer. Analyze the given thought and determine what action should be taken.

Available tools:
${toolsList || '(none)'}

Available skills:
${skillsList || '(none)'}

Available agents:
${agentsList || '(none)'}

Respond with a JSON object with this exact format:
{
  "type": "tool" | "skill" | "agent" | "escalate" | "none",
  "target": "name of tool/skill/agent or empty string if type is 'none' or 'escalate'",
  "reason": "brief explanation of why this action is needed",
  "confidence": 0.0 to 1.0,
  "input": {} // optional for type='tool', include arguments when clear
}

Rules:
- Only suggest tools/skills/agents that are actually available
- If the thought indicates the model has enough information to answer, return type "none"
- If the thought indicates a need for more powerful reasoning, return type "escalate"
- Return high confidence (0.8+) only if the intent is very clear
- Return low confidence (0.3-0.5) if the intent is ambiguous
- Analyze semantically, not by keyword matching`;

    try {
      const response = await this.provider.complete({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Analyze this thought:\n\n${thought}` },
        ],
        temperature: 0.3,
        maxTokens: 256,
      });

      const allJsonMatches = extractJsonObjects(response.content);
      if (allJsonMatches.length > 1) {
        console.warn(`[IntentAnalyzer] Model emitted ${allJsonMatches.length} JSON objects. Taking first.`);
      }

      const parsed = parseFirstJsonObject<any>(response.content, { tryRepair: true });
      if (!parsed) {
        return {
          type: 'none',
          target: '',
          reason: 'Could not parse intent analysis response',
          confidence: 0,
        };
      }

      return {
        type: parsed.value.type || 'none',
        target: parsed.value.target || '',
        reason: parsed.value.reason || 'No reason provided',
        confidence: typeof parsed.value.confidence === 'number' ? parsed.value.confidence : 0.5,
        input: parsed.value && typeof parsed.value.input === 'object' && parsed.value.input !== null
          ? parsed.value.input
          : undefined,
      };
    } catch (error) {
      console.error('IntentAnalyzer.analyzeIntent() error:', error);
      return {
        type: 'none',
        target: '',
        reason: 'Error during intent analysis',
        confidence: 0,
      };
    }
  }
}
