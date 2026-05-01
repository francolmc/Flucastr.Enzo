import { mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { DatabaseManager } from './Database.js';
import { MemoryService } from './MemoryService.js';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function clearDbSingleton(): void {
  (DatabaseManager as unknown as { instance: DatabaseManager | undefined }).instance = undefined;
}

async function runTests(): Promise<void> {
  console.log('MemoryService history ordering tests...\n');
  const tmpDir = resolve(process.cwd(), 'tmp');
  mkdirSync(tmpDir, { recursive: true });
  const dbPath = join(tmpDir, `history-order-${Date.now()}.db`);
  clearDbSingleton();

  const ms = new MemoryService(dbPath);
  const cid = 'conv-history-test';
  await ms.ensureConversation(cid, 'user-h');

  for (let i = 0; i < 25; i++) {
    await ms.saveMessage(
      cid,
      { role: i % 2 === 0 ? 'user' : 'assistant', content: `msg-${i}` },
      undefined,
      undefined
    );
    await new Promise((r) => setTimeout(r, 3));
  }

  const last10 = await ms.getHistory(cid, 10);
  assert(last10.length === 10, `expected 10 messages, got ${last10.length}`);
  assert(last10[0]!.content === 'msg-15', `expected first of window msg-15, got ${last10[0]!.content}`);
  assert(last10[9]!.content === 'msg-24', `expected last msg-24, got ${last10[9]!.content}`);

  const meta = await ms.getHistoryWithMetadata(cid, 10);
  assert(meta.length === 10, `metadata length ${meta.length}`);
  assert(meta[0]!.content === 'msg-15', 'metadata ordering matches getHistory');

  DatabaseManager.getInstance().close();
  clearDbSingleton();
  console.log('✓ getHistory / getHistoryWithMetadata return newest window in chronological order\n');
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
