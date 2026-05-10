import { mkdtemp, writeFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { FileHandler } from './FileHandler.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function todayDir(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, '0');
  const d = `${now.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function runTests(): Promise<void> {
  console.log('FileHandler tests...\n');

  const base = await mkdtemp(path.join(os.tmpdir(), 'enzo-fh-'));
  try {
    const fh = new FileHandler({ workspacePath: base, maxSizeMb: 50 });
    const rel = await fh.save(Buffer.from('hello'), 'test.txt', 'text/plain');

    assert(path.dirname(rel.localPath).endsWith(path.join('uploads', todayDir())), 'save path uses uploads/YYYY-MM-DD');
    assert(rel.extension === '.txt', 'extension');
    assert(rel.mimeType === 'text/plain', 'mime');
    assert(rel.sizeBytes === 5, 'sizeBytes');

    const round = await fh.read(rel.localPath);
    assert(round.toString('utf8') === 'hello', 'read buffer');

    assert((await fh.exists(rel.localPath)) === true, 'exists true');
    assert((await fh.exists(path.join(base, 'nope'))) === false, 'exists false');

    await fh.save(Buffer.from('again'), 'test.txt', 'text/plain');
    const dup = path.join(path.dirname(rel.localPath), 'test_1.txt');
    assert((await fh.exists(dup)), 'duplicate gets _1');
    assert((await fh.read(dup)).toString('utf8') === 'again', 'read duplicate');

    const tiny = new FileHandler({ workspacePath: base, maxSizeMb: 0 });
    let threw = false;
    try {
      await tiny.save(Buffer.from('x'), 'big.bin', 'application/octet-stream');
    } catch (e) {
      threw = e instanceof Error && /supera el tamaño|maximum|MiB/i.test(e.message);
    }
    assert(threw, 'oversize throws descriptive error');

    console.log('FileHandler tests: OK');
  } finally {
    await rm(base, { recursive: true, force: true }).catch(() => {});
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
