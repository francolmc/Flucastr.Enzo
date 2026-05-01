import {
  detectFollowUp,
  summarizeOpenThread,
  buildConversationFlowBlock,
} from '../ConversationFlow.js';
function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

async function runTests(): Promise<void> {
  console.log('ConversationFlow tests...\n');

  const r1 = detectFollowUp('y eso?', [{ role: 'user', content: 'Te hablé de Rust antes.' }]);
  assert(r1.kind === 'follow_up', 'short follow-up');

  const r2 = detectFollowUp('dejemos eso y hablemos de Python', [
    { role: 'user', content: 'hola' },
    { role: 'assistant', content: 'hola' },
  ]);
  assert(r2.kind === 'topic_shift', 'topic shift phrase');

  const r3 = detectFollowUp('what is 2+2?', []);
  assert(r3.kind === 'new_topic', 'empty thread');

  const hint = summarizeOpenThread([
    { role: 'user', content: 'explain rust' },
    { role: 'assistant', content: 'rust is ...' },
  ]);
  assert(hint !== undefined && hint.includes('rust'), 'open thread hint');

  const block = buildConversationFlowBlock({ kind: 'follow_up', confidence: 0.8 }, 'OPEN');
  assert(block.includes('follow_up'), 'flow block');

  console.log('✓ ConversationFlow heuristics\n');
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
