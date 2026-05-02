import assert from 'node:assert/strict';

import { messageLooksLikeMailboxUnreadStatsQuery } from '../mailboxUnreadIntent.js';

function run(): void {
  assert.equal(
    messageLooksLikeMailboxUnreadStatsQuery(
      '¿Cuántos correos de gmail y cuántos correos de outlook tengo sin leer?'
    ),
    true
  );
  assert.equal(messageLooksLikeMailboxUnreadStatsQuery('hola cómo estás'), false);
  assert.equal(messageLooksLikeMailboxUnreadStatsQuery('¿cuántos correos tengo sin leer en gmail?'), true);
}

run();
