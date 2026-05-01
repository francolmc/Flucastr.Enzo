import type { AmplifierInput } from '../types.js';
import type { Message } from '../../providers/types.js';

/** Dialogue + continuity system blocks for LLM calls (THINK / SIMPLE / synthesize). */
export function resolveAmplifierDialogueMessages(input: AmplifierInput): Message[] {
  if (input.conversation) {
    const systems = input.conversation.continuitySystemBlocks.map((content) => ({
      role: 'system' as const,
      content,
    }));
    return [...systems, ...input.conversation.recentTurns];
  }
  return input.history;
}
