import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { DatabaseManager } from './Database.js';
import { MemoryService } from './MemoryService.js';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function clearDbSingleton(): void {
  (DatabaseManager as unknown as { instance: DatabaseManager | undefined }).instance = undefined;
}

const LEGACY_JSON = JSON.stringify({
  conversations: [],
  messages: [],
  memories: [],
  usage_stats: [],
  agents: [],
  conversation_agent_state: [],
  skills_config: [],
  mcp_servers: [],
});

function rmIfExists(p: string): void {
  if (existsSync(p)) rmSync(p, { force: true });
}

function cleanupAfterLegacy(tmpDir: string, baseName: string): void {
  for (const f of readdirSync(tmpDir)) {
    if (f.startsWith(baseName)) {
      rmSync(join(tmpDir, f), { force: true });
    }
  }
}

async function runTests(): Promise<void> {
  console.log('Database tests...\n');
  const tmpDir = resolve(process.cwd(), 'tmp');
  mkdirSync(tmpDir, { recursive: true });

  const baseSingleton = 'db-singleton-probe';
  const dbSingleton = join(tmpDir, `${baseSingleton}.db`);
  cleanupAfterLegacy(tmpDir, baseSingleton);

  console.log('Test: getInstance is singleton for same app');
  clearDbSingleton();
  const a = DatabaseManager.getInstance(dbSingleton);
  const b = DatabaseManager.getInstance(dbSingleton);
  assert(a === b, 'expected same DatabaseManager instance');
  a.close();
  clearDbSingleton();
  cleanupAfterLegacy(tmpDir, baseSingleton);
  console.log('✓ Passed\n');

  const baseRemember = 'db-remember-probe';
  const dbRemember = join(tmpDir, `${baseRemember}.db`);
  cleanupAfterLegacy(tmpDir, baseRemember);
  clearDbSingleton();
  const ms = new MemoryService(dbRemember);
  await ms.remember('u-test-1', 'ping', 'pong');
  const rows = await ms.recall('u-test-1', 'ping');
  assert(rows.length === 1 && rows[0]!.value === 'pong', 'expected remember/recall to persist');
  DatabaseManager.getInstance().close();
  clearDbSingleton();
  cleanupAfterLegacy(tmpDir, baseRemember);
  console.log('✓ set/get (remember/recall) passed\n');

  const baseLegacy = 'db-legacy-migrate-probe';
  const legacyPath = join(tmpDir, `${baseLegacy}.db`);
  cleanupAfterLegacy(tmpDir, baseLegacy);
  clearDbSingleton();
  writeFileSync(legacyPath, LEGACY_JSON, 'utf-8');
  let threw = false;
  try {
    DatabaseManager.getInstance(legacyPath);
  } catch {
    threw = true;
  }
  assert(!threw, 'legacy JSON migration should not throw');
  DatabaseManager.getInstance().close();
  clearDbSingleton();
  cleanupAfterLegacy(tmpDir, baseLegacy);
  console.log('✓ legacy JSON migration did not throw\n');

  console.log('Database tests passed.');
}

void runTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
