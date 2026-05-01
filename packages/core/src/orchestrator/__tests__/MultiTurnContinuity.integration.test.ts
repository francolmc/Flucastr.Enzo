import { resolveAmplifierDialogueMessages } from '../amplifier/ContinuityMessages.js';
import type { AmplifierInput } from '../types.js';
import { ComplexityLevel } from '../types.js';
import type { ConversationContext } from '../../memory/ConversationContext.js';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

async function runTests(): Promise<void> {
  console.log('Multi-turn continuity integration (Amplifier messages)...\n');

  const conversation: ConversationContext = {
    continuitySystemBlocks: ['PROFILE', 'RESUMEN: old'],
    recentTurns: [
      { role: 'user', content: 'turn-a' },
      { role: 'assistant', content: 'turn-b' },
      { role: 'user', content: 'turn-c' },
    ],
    recentRecords: [],
    droppedRecords: [],
    droppedTurns: 0,
    estimatedTokensRecent: 10,
    estimatedTokensContinuity: 5,
    summaryUsed: true,
    rollingSummaryText: undefined,
    flowKind: 'follow_up',
    flowConfidence: 0.7,
    openThreadHint: undefined,
  };

  const input: AmplifierInput = {
    message: 'next',
    conversationId: 'c',
    userId: 'u',
    history: [],
    availableTools: [],
    availableSkills: [],
    availableAgents: [],
    classifiedLevel: ComplexityLevel.SIMPLE,
    conversation,
  };

  const msgs = resolveAmplifierDialogueMessages(input);
  assert(msgs.length === 5, `expected 2 system + 3 dialogue, got ${msgs.length}`);
  assert(msgs[0]!.role === 'system' && msgs[0]!.content === 'PROFILE', 'first continuity block');
  assert(msgs[msgs.length - 1]!.role === 'user' && msgs[msgs.length - 1]!.content === 'turn-c', 'last dialogue');

  console.log('✓ resolveAmplifierDialogueMessages merges continuity + recent turns\n');
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
