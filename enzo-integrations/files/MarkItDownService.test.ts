import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import type { SpawnOptions } from 'child_process';
import { MarkItDownConverter } from './MarkItDownConverter.js';

const TRUNCATE_NOTE =
  '\n\n[Contenido truncado — documento muy largo. Se muestran los primeros 50.000 caracteres.]';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function fakeChild(opts: {
  stdout?: string;
  stderr?: string;
  code?: number | null;
  neverClose?: boolean;
  spawnError?: Error;
}): ChildProcessWithoutNullStreams {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
  child.stdout = stdout;
  child.stderr = stderr;
  (child as unknown as { kill: (s?: NodeJS.Signals) => boolean }).kill = () => true;

  queueMicrotask(() => {
    if (opts.spawnError) {
      child.emit('error', opts.spawnError);
      return;
    }
    if (opts.neverClose) {
      return;
    }
    if (opts.stdout) {
      stdout.push(Buffer.from(opts.stdout));
    }
    stdout.end();
    if (opts.stderr) {
      stderr.push(Buffer.from(opts.stderr));
    }
    stderr.end();
    child.emit('close', opts.code ?? 0);
  });

  return child;
}

async function runTests(): Promise<void> {
  console.log('MarkItDownService tests...\n');

  const conv = new MarkItDownConverter();
  assert(conv.isSupported('.pdf') === true, 'isSupported .pdf');
  assert(conv.isSupported('pdf') === true, 'isSupported pdf without dot');
  assert(conv.isSupported('.exe') === false, 'isSupported rejects .exe');

  const base = await mkdtemp(join(os.tmpdir(), 'enzo-markitdown-'));
  try {
    const pdfPath = join(base, 'doc.pdf');
    await writeFile(pdfPath, '%PDF-1.4\n');

    const ok = new MarkItDownConverter({
      spawnImpl: () => fakeChild({ code: 0, stdout: '# Hello\n' }),
    });
    const r1 = await ok.convert(pdfPath);
    assert(r1.success === true, 'conversion success flag');
    assert(r1.markdown === '# Hello\n', 'markdown from stdout');

    let spawnCalls: string[] = [];
    const fallback = new MarkItDownConverter({
      spawnImpl: (cmd: string, _args: readonly string[], _opts: SpawnOptions) => {
        spawnCalls.push(cmd);
        if (cmd === 'python3') {
          return fakeChild({ code: 1, stderr: 'No module named markitdown' });
        }
        return fakeChild({ code: 0, stdout: 'via-markitdown-cli' });
      },
    });
    const r2 = await fallback.convert(pdfPath);
    assert(r2.success === true, 'fallback success');
    assert(r2.markdown === 'via-markitdown-cli', 'fallback markdown');
    assert(spawnCalls[0] === 'python3' && spawnCalls[1] === 'markitdown', 'python3 then markitdown');

    const bothFail = new MarkItDownConverter({
      spawnImpl: (cmd: string) =>
        cmd === 'python3'
          ? fakeChild({ code: 1, stderr: 'python failed' })
          : fakeChild({ code: 127, stderr: 'not found' }),
    });
    const r3 = await bothFail.convert(pdfPath);
    assert(r3.success === false, 'both fail → success false');
    assert((r3.error ?? '').length > 0, 'both fail → error string');
    assert(r3.markdown === undefined, 'both fail → no markdown');

    const timedOut = new MarkItDownConverter({
      timeoutMs: 80,
      spawnImpl: () => fakeChild({ neverClose: true }),
    });
    const r4 = await timedOut.convert(pdfPath);
    assert(r4.success === false, 'timeout → success false');
    assert(/timeout/i.test(r4.error ?? ''), 'timeout → error mentions timeout');

    const huge = 'x'.repeat(50_001);
    const trunc = new MarkItDownConverter({
      spawnImpl: () => fakeChild({ code: 0, stdout: huge }),
    });
    const r5 = await trunc.convert(pdfPath);
    assert(r5.success === true, 'truncate case success');
    assert(r5.markdown!.endsWith(TRUNCATE_NOTE), 'truncate note appended');
    assert(r5.markdown!.length === 50_000 + TRUNCATE_NOTE.length, 'truncate length');

    const missing = await conv.convert(join(base, 'nope.pdf'));
    assert(missing.success === false && (missing.error ?? '').includes('not found'), 'missing file');
  } finally {
    await rm(base, { recursive: true, force: true }).catch(() => {});
  }

  console.log('MarkItDownService tests: OK');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
