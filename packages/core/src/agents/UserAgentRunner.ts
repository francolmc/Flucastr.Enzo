import type { ConfigService } from '../config/ConfigService.js';
import type { AgentConfig } from '../orchestrator/types.js';
import { instantiateProviderForAgent } from '../orchestrator/instantiateProviderForAgent.js';
import { runAnthropicVisionTask } from './anthropicDelegationUtils.js';
import type { DelegationRequest, DelegationResult } from './AgentRouter.js';

function buildVisionSystemPrompt(request: DelegationRequest, agent: AgentConfig): string {
  const base =
    agent.systemPrompt?.trim() ||
    `You are "${agent.name}", a delegated assistant on behalf of Enzo. Analyze the attached image faithfully.`;
  const mem = request.context.memories.map((m) => `- ${m.key}: ${m.value}`).join('\n');
  return `${base}

USER CONTEXT:
${mem || '(none)'}

CONVERSATION SUMMARY:
${request.context.conversationSummary}

${request.context.previousStepResults ? `PREVIOUS RESULTS:\n${request.context.previousStepResults}` : ''}`;
}

function buildTextUserPrompt(request: DelegationRequest): string {
  const parts: string[] = [];
  if (request.context.memories.length) {
    parts.push(`Memories:\n${request.context.memories.map((m) => `- ${m.key}: ${m.value}`).join('\n')}`);
  }
  parts.push(`Conversation summary:\n${request.context.conversationSummary}`);
  if (request.context.previousStepResults) {
    parts.push(`Previous step results:\n${request.context.previousStepResults}`);
  }
  parts.push(`Delegated task:\n${request.task}`);
  return parts.join('\n\n');
}

/**
 * Runs a user-defined {@link AgentConfig} preset for THINK-phase delegation (text or Anthropic multimodal image).
 */
export class UserAgentRunner {
  constructor(private readonly configService: ConfigService) {}

  async execute(request: DelegationRequest, agent: AgentConfig): Promise<DelegationResult> {
    const providerName = (agent.provider || '').toLowerCase();
    const b64 = request.context.imageBase64?.trim();
    const mime = request.context.imageMimeType?.trim();
    const hasImage = !!(b64 && mime);

    if (hasImage) {
      if (providerName === 'anthropic') {
        const systemPrompt = buildVisionSystemPrompt(request, agent);
        return runAnthropicVisionTask({
          configService: this.configService,
          systemPrompt,
          task: request.task,
          imageBase64: b64!,
          imageMimeType: mime!,
          model: agent.model?.trim(),
          resultAgentId: agent.id,
        });
      }
      return {
        success: false,
        agent: agent.id,
        output: '',
        error: `User agent "${agent.name}" (${agent.provider}) cannot process attached images in this build — use an Anthropic preset or delegate to vision_agent.`,
      };
    }

    try {
      const provider = await instantiateProviderForAgent(this.configService, agent);
      const system =
        agent.systemPrompt?.trim() ||
        `You are "${agent.name}". Answer the delegated task clearly and follow any persona implied by your name.`;
      const userContent = buildTextUserPrompt(request);
      const resp = await provider.complete({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        temperature: 0.35,
        maxTokens: 4096,
      });
      const text = (resp.content ?? '').trim();
      return { success: true, agent: agent.id, output: text || '(empty model response)' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, agent: agent.id, output: '', error: msg };
    }
  }
}
