import type { LLMProvider } from '../providers/types.js';
import { MemoryService } from './MemoryService.js';
import type { MessageRecord } from './types.js';

/**
 * Merges dropped turns into a rolling summary stored per conversation.
 * Runs asynchronously after the user receives a response.
 */
export class ConversationSummarizer {
  constructor(
    private readonly provider: LLMProvider,
    private readonly memoryService: MemoryService
  ) {}

  /** Non-blocking: schedules summarization on the next tick. */
  mergeOlderTurnsInBackground(input: {
    conversationId: string;
    droppedRecords: MessageRecord[];
    previousSummary?: string;
  }): void {
    const { conversationId, droppedRecords, previousSummary } = input;
    if (droppedRecords.length === 0) {
      return;
    }
    void Promise.resolve()
      .then(() => this.mergeOlderTurns(conversationId, droppedRecords, previousSummary))
      .catch((err) => console.error('[ConversationSummarizer] merge failed:', err));
  }

  private async mergeOlderTurns(
    conversationId: string,
    dropped: MessageRecord[],
    previousSummary?: string
  ): Promise<void> {
    const dialogue = dropped.map((r) => `${r.role}: ${r.content}`).join('\n');
    const prior = previousSummary?.trim() ? `Prior summary:\n${previousSummary.trim()}\n\n` : '';

    const systemPrompt = `You compress dialogue into a SHORT bullet summary (Spanish if the dialogue is Spanish).
Include: topics discussed, decisions, paths/commands mentioned, open questions.
Do NOT invent facts. Max ~350 words. Use bullets starting with "- ".`;

    const userPrompt = `${prior}Older turns to merge:\n${dialogue}`;

    const response = await this.provider.complete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      maxTokens: 512,
    });

    const summary = (response.content ?? '').trim();
    if (!summary) {
      console.warn('[ConversationSummarizer] Empty summary from model; skipping persist');
      return;
    }

    const last = dropped[dropped.length - 1]!;
    await this.memoryService.upsertConversationSummary({
      conversationId,
      summary,
      upToMessageId: last.id,
      upToCreatedAt: last.createdAt,
      topicHint: undefined,
    });
    console.log(`[ConversationSummarizer] Updated rolling summary for ${conversationId} (${dropped.length} turns)`);
  }
}
