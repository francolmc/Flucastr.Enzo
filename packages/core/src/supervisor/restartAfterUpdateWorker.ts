/**
 * Subprocess: wait, SIGTERM the old `./enzo start` supervisor, then launch a new one.
 * Invoked with: `node restartAfterUpdateWorker.js <pid> <repoRoot>`
 */
import { spawn } from 'child_process';
import { appendFileSync, openSync } from 'fs';
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
  appendFileSync(logPath, `\n[${new Date().toISOString()}] restart worker launching new supervisor\n`);
  const fd = openSync(logPath, 'a');
  const child = spawn(process.execPath, ['packages/cli/dist/index.js', 'start'], {
    cwd: root,
    shell: false,
    detached: true,
    env: {
      ...process.env,
      ENZO_SKIP_SUPERVISOR_GUARD: '1',
    },
    stdio: ['ignore', fd, fd],
  });
  child.on('error', (error) => {
    appendFileSync(logPath, `[${new Date().toISOString()}] restart worker spawn error: ${error.message}\n`);
  });
  appendFileSync(logPath, `[${new Date().toISOString()}] restart worker spawned pid=${child.pid ?? 'unknown'}\n`);
  child.unref();
  setTimeout(() => process.exit(0), 200);
}

main().catch((e) => {
  console.error('[Enzo] restartAfterUpdateWorker failed:', e);
  process.exit(1);
});
