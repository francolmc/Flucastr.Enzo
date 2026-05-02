import assert from 'node:assert/strict';

import type { ConversationContext } from '../../memory/ConversationContext.js';
import {
  mailboxUnreadSummaryLockCorpus,
  messageLooksLikeMailboxUnreadStatsQuery,
  messageLooksLikeMailboxUnreadSummaryQuery,
} from '../mailboxUnreadIntent.js';

function run(): void {
  assert.equal(
    messageLooksLikeMailboxUnreadStatsQuery(
      '¿Cuántos correos de gmail y cuántos correos de outlook tengo sin leer?'
    ),
    true
  );
  assert.equal(messageLooksLikeMailboxUnreadStatsQuery('hola cómo estás'), false);
  assert.equal(messageLooksLikeMailboxUnreadStatsQuery('¿cuántos correos tengo sin leer en gmail?'), true);

  assert.equal(
    messageLooksLikeMailboxUnreadSummaryQuery(
      'me puedes resumir los correos más importantes sin leer en gmail y outlook'
    ),
    true
  );
  assert.equal(messageLooksLikeMailboxUnreadSummaryQuery('cantidad de peso de la tierra'), false);

  const priorUnreadSummaryThread: ConversationContext = {
    continuitySystemBlocks: [],
    recentTurns: [
      { role: 'user', content: 'me puedes resumir los correos más importantes sin leer en gmail y outlook?' },
      { role: 'assistant', content: 'Necesito acceder a tu bandeja…' },
    ],
    recentRecords: [],
    droppedRecords: [],
    droppedTurns: 0,
    estimatedTokensRecent: 0,
    estimatedTokensContinuity: 0,
    summaryUsed: false,
    flowKind: 'follow_up',
    flowConfidence: 0.5,
  };
  const followUpCorpus = mailboxUnreadSummaryLockCorpus({
    message: 'si tienes acceso a mis correos',
    conversation: priorUnreadSummaryThread,
  });
  assert.equal(messageLooksLikeMailboxUnreadSummaryQuery(followUpCorpus), true);
}

run();
