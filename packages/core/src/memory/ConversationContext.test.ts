import { buildConversationContext, estimateTextTokens } from './ConversationContext.js';
import type { MessageRecord } from './types.js';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function makeRecords(n: number): MessageRecord[] {
  const out: MessageRecord[] = [];
  const base = 1000000;
  for (let i = 0; i < n; i++) {
    out.push({
      id: `id-${i}`,
      conversationId: 'c1',
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'word '.repeat(80),
      createdAt: base + i,
    });
  }
  return out;
}

async function runTests(): Promise<void> {
  console.log('ConversationContext tests...\n');

  assert(estimateTextTokens('abcd') >= 1, 'tokenizer returns positive');

  const records = makeRecords(30);
  const ctx = buildConversationContext({
    records,
    profileMemoryBlock: 'profile block',
    rollingSummary: 'old topics discussed',
    flowBlock: 'FLOW',
    budgetTokens: 800,
    reservedForResponse: 100,
    flowKind: 'follow_up',
    flowConfidence: 0.9,
    openThreadHint: 'hint',
  });

  assert(ctx.droppedTurns > 0, 'should drop old turns under tight budget');
  assert(ctx.recentTurns.length >= 1, 'should keep at least one turn');
  const lastRec = records[records.length - 1]!;
  assert(
    ctx.recentRecords.some((r) => r.id === lastRec.id),
    'most recent message should stay in window'
  );
  assert(ctx.summaryUsed === true, 'summaryUsed');
  assert(ctx.flowKind === 'follow_up', 'flow kind');

  console.log('✓ token budget drops older turns but keeps recent tail\n');
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
