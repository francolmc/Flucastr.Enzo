/**
 * Subprocess: wait, SIGTERM the old `./enzo start` supervisor, then launch a new one.
 * Invoked with: `node restartAfterUpdateWorker.js <pid> <repoRoot>`
 */
import { spawn } from 'child_process';
import { openSync } from 'fs';
import { join } from 'path';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const pid = Number(process.argv[2]);
  const root = process.argv[3];

  if (!Number.isInteger(pid) || pid <= 0 || !root) {
    console.error('[Enzo] restartAfterUpdateWorker: need pid and repoRoot');
    process.exit(1);
  }

  await delay(2000);
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // ignore: process may already be gone
  }
  await delay(4000);

  const logPath = join(root, '.enzo-restart.log');
  const fd = openSync(logPath, 'a');
  const child = spawn(process.execPath, ['packages/cli/dist/index.js', 'start'], {
    cwd: root,
    shell: false,
    detached: true,
    stdio: ['ignore', fd, fd],
  });
  child.unref();
  setTimeout(() => process.exit(0), 200);
}

main().catch((e) => {
  console.error('[Enzo] restartAfterUpdateWorker failed:', e);
  process.exit(1);
});
