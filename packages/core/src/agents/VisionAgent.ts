import type { ConfigService } from '../config/ConfigService.js';
import type { VisionService } from '../vision/VisionService.js';
import { runAnthropicVisionTask } from './anthropicDelegationUtils.js';
import type { DelegationRequest, DelegationResult } from './AgentRouter.js';

function buildSystemPrompt(request: DelegationRequest): string {
  return `You are a vision assistant.
You analyze images on behalf of Enzo, an AI personal assistant.

USER CONTEXT:
${request.context.memories.map((m) => `- ${m.key}: ${m.value}`).join('\n')}

CONVERSATION SUMMARY:
${request.context.conversationSummary}

${request.context.previousStepResults ? `PREVIOUS RESULTS:\n${request.context.previousStepResults}` : ''}

Answer the task using only what you see in the image. Be specific and thorough.
If there is code, text, or error messages in the image, transcribe them exactly.`;
}

export class VisionAgent {
  constructor(
    private readonly configService: ConfigService,
    /** When Anthropic fails (bad key, rate limit, etc.), analyze once with the host’s Ollama vision (e.g. Telegram). */
    private readonly localVision?: VisionService
  ) {}

  async execute(request: DelegationRequest): Promise<DelegationResult> {
    const b64 = request.context.imageBase64?.trim();
    const mime = request.context.imageMimeType?.trim();
    if (!b64 || !mime) {
      return {
        success: false,
        agent: 'vision_agent',
        output: '',
        error: 'vision_agent requires context.imageBase64 and context.imageMimeType',
      };
    }

    const cloud = await runAnthropicVisionTask({
      configService: this.configService,
      systemPrompt: buildSystemPrompt(request),
      task: request.task,
      imageBase64: b64,
      imageMimeType: mime,
    });
    if (cloud.success) return cloud;

    if (this.localVision) {
      try {
        const buf = Buffer.from(b64, 'base64');
        const local = await this.localVision.analyze(buf, mime, request.task);
        if (local.success && local.description?.trim()) {
          return {
            success: true,
            agent: 'vision_agent',
            output: `[Análisis con modelo local (Ollama) — conviene contrastar si la tarea es crítica]\n\n${local.description.trim()}`,
          };
        }
        if (local.error?.trim()) {
          return {
            success: false,
            agent: 'vision_agent',
            output: '',
            error: `${cloud.error ?? 'Anthropic vision failed'}. Local vision: ${local.error.trim()}`,
          };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          agent: 'vision_agent',
          output: '',
          error: `${cloud.error ?? 'Anthropic vision failed'}. Local vision error: ${msg}`,
        };
      }
    }

    return cloud;
  }
}
