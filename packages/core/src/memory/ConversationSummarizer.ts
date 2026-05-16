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

    const systemPrompt = `You compress conversation history into a structured JSON snapshot.
Respond ONLY with valid JSON, no extra text:

{
  "user_goal": "main objective the user is pursuing in this session (1 sentence)",
  "completed": ["action 1 done", "action 2 done"],
  "established_facts": ["concrete fact 1", "concrete fact 2"],
  "pending": "what remains unresolved or next step",
  "last_tool_results": {"tool_name": "result summary in 1 line"}
}

RULES:
- Be factual — only include what was explicitly said or done
- Mark anything uncertain as UNVERIFIED
- Do not invent actions or results
- If nothing to summarize, return {"user_goal":"","completed":[],"established_facts":[],"pending":"","last_tool_results":{}}`;

    const userPrompt = `${prior}Older turns to merge:\n${dialogue}`;

    const response = await this.provider.complete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      maxTokens: 512,
    });

    let summaryText = (response.content ?? '').trim();
    if (!summaryText) {
      console.warn('[ConversationSummarizer] Empty summary from model; skipping persist');
      return;
    }

    try {
      JSON.parse(summaryText);
    } catch {
      summaryText = JSON.stringify({
        user_goal: '',
        completed: [],
        established_facts: [],
        pending: summaryText.substring(0, 200),
        last_tool_results: {},
      });
    }

    const last = dropped[dropped.length - 1]!;
    await this.memoryService.upsertConversationSummary({
      conversationId,
      summary: summaryText,
      upToMessageId: last.id,
      upToCreatedAt: last.createdAt,
      topicHint: undefined,
    });
    console.log(`[ConversationSummarizer] Updated rolling summary for ${conversationId} (${dropped.length} turns)`);
  }
}
