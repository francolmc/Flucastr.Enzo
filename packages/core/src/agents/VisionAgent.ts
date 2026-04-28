import type { ConfigService } from '../config/ConfigService.js';
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
  constructor(private readonly configService: ConfigService) {}

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

    return runAnthropicVisionTask({
      configService: this.configService,
      systemPrompt: buildSystemPrompt(request),
      task: request.task,
      imageBase64: b64,
      imageMimeType: mime,
    });
  }
}
