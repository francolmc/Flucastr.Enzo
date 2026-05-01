import { mkdirSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { DatabaseManager } from '../memory/Database.js';
import { CalendarService } from './CalendarService.js';
import { CalendarTool } from '../tools/CalendarTool.js';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function clearDbSingleton(): void {
  (DatabaseManager as unknown as { instance: DatabaseManager | undefined }).instance = undefined;
}

function rmIfExists(p: string): void {
  if (existsSync(p)) rmSync(p, { force: true });
}

async function runTests(): Promise<void> {
  console.log('CalendarService tests...\n');
  const tmpDir = resolve(process.cwd(), 'tmp');
  mkdirSync(tmpDir, { recursive: true });
  const dbPath = join(tmpDir, `calendar-unit-${Date.now()}.db`);
  rmIfExists(dbPath);

  clearDbSingleton();
  const svc = new CalendarService(dbPath);
  const t0 = Date.parse('2026-06-01T12:00:00.000Z');
  const t1 = Date.parse('2026-06-02T12:00:00.000Z');

  const a = await svc.insert('alice', { title: 'A', startAt: t0, notes: 'n1' });
  assert(a.title === 'A' && a.startAt === t0, 'insert A');

  const b = await svc.insert('alice', { title: 'B', startAt: t1, endAt: t1 + 3600_000 });
  assert(b.endAt === t1 + 3600_000, 'insert B end');

  const list = await svc.listInRange('alice', t0 - 1000, t1 + 1000);
  assert(list.length === 2, 'list expects 2 events');

  const listBob = await svc.listInRange('bob', t0 - 1000, t1 + 86400_000);
  assert(listBob.length === 0, 'bob isolation');

  const patched = await svc.update('alice', a.id, { title: 'A2' });
  assert(patched?.title === 'A2', 'patch title');

  const calTool = new CalendarTool(svc);
  const scopedList = await calTool.execute({
    action: 'list',
    from_iso: new Date(t0).toISOString(),
    to_iso: new Date(t1).toISOString(),
    __enzoScopedUserId: 'alice',
  });
  assert(scopedList.success && scopedList.output.includes('A2'), 'calendar tool list');

  const scopedBad = await calTool.execute({
    action: 'list',
    from_iso: new Date(t0).toISOString(),
    to_iso: new Date(t1).toISOString(),
  });
  assert(!scopedBad.success, 'reject without scoped user');

  const delOk = await svc.delete('alice', b.id);
  assert(delOk, 'delete');

  DatabaseManager.getInstance().close();
  clearDbSingleton();
  rmIfExists(dbPath);

  console.log('✓ CalendarService / CalendarTool passed\n');
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
