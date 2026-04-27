import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ENZO_SUPERVISOR_STATE_FILENAME, type EnzoSupervisorState } from './supervisorState.js';

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export type ScheduleEnzoRestartKind = 'custom_command' | 'supervisor' | 'skipped';

export interface ScheduleEnzoSupervisorRestartResult {
  kind: ScheduleEnzoRestartKind;
  /** User-facing line(s) for Telegram or logs. */
  userMessage: string;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * After `git pull` + build, restarts the full Enzo stack.
 *
 * - `ENZO_UPDATE_RESTART_CMD` or `ENZO_RESTART_CMD` (if set): run as a shell step (e.g. `systemctl --user restart enzo`).
 * - Otherwise: if `.enzo-supervisor.json` exists (written by `./enzo start`) and the PID is alive, spawns a detached
 *   worker that SIGTERMs the old supervisor and runs `./enzo start` again.
 */
export function scheduleEnzoSupervisorRestart(options: {
  cwd: string;
  env?: NodeJS.ProcessEnv;
}): ScheduleEnzoSupervisorRestartResult {
  const cwd = options.cwd;
  const env = options.env ?? process.env;
  const custom = env.ENZO_UPDATE_RESTART_CMD?.trim() || env.ENZO_RESTART_CMD?.trim();
  if (custom) {
    const child = spawn(custom, { shell: true, cwd, detached: true, stdio: 'ignore' });
    child.unref();
    return {
      kind: 'custom_command',
      userMessage:
        'Reinicio solicitado: se ejecutó tu comando (ENZO_UPDATE_RESTART_CMD) en segundo plano.',
    };
  }

  const path = join(cwd, ENZO_SUPERVISOR_STATE_FILENAME);
  if (!existsSync(path)) {
    return {
      kind: 'skipped',
      userMessage:
        'Código y build al día, pero no hay registro de un `./enzo start` en este repo ' +
        `(falta ${ENZO_SUPERVISOR_STATE_FILENAME}). Arranca manualmente o define ENZO_UPDATE_RESTART_CMD en el entorno del proceso.`,
    };
  }

  let state: EnzoSupervisorState;
  try {
    state = JSON.parse(readFileSync(path, 'utf-8')) as EnzoSupervisorState;
  } catch {
    return {
      kind: 'skipped',
      userMessage: `No se pudo leer ${ENZO_SUPERVISOR_STATE_FILENAME}. Reinicia a mano: \`./enzo start\`.`,
    };
  }

  if (!isProcessAlive(state.pid)) {
    return {
      kind: 'skipped',
      userMessage: 'El supervisor (`./enzo start`) no estaba corriendo. Inicia: `./enzo start`.',
    };
  }

  const root = (state.root || cwd).trim();
  const logPath = join(root, '.enzo-restart.log');
  const qRoot = shQuote(root);
  const qLogPath = shQuote(logPath);
  const restartScript = [
    `LOG=${qLogPath}`,
    'echo "" >> "$LOG"',
    'echo "[$(date -Iseconds)] restart scheduler started" >> "$LOG"',
    'echo "[$(date -Iseconds)] stopping old supervisor and residual processes" >> "$LOG"',
    'sleep 2',
    `kill -TERM ${state.pid} >/dev/null 2>&1 || true`,
    'echo "[$(date -Iseconds)] old supervisor signal sent" >> "$LOG"',
    // Hard-stop leftovers from the same repository before restart.
    `pkill -TERM -f "pnpm -F @enzo/api start" >/dev/null 2>&1 || true`,
    `pkill -TERM -f "pnpm -F @enzo/telegram start" >/dev/null 2>&1 || true`,
    `pkill -TERM -f "${root}/packages/ui/.*vite" >/dev/null 2>&1 || true`,
    'lsof -ti :3001 | xargs -r kill -TERM >/dev/null 2>&1 || true',
    'lsof -ti :3004 | xargs -r kill -TERM >/dev/null 2>&1 || true',
    'sleep 2',
    `pkill -KILL -f "pnpm -F @enzo/api start" >/dev/null 2>&1 || true`,
    `pkill -KILL -f "pnpm -F @enzo/telegram start" >/dev/null 2>&1 || true`,
    `pkill -KILL -f "${root}/packages/ui/.*vite" >/dev/null 2>&1 || true`,
    'lsof -ti :3001 | xargs -r kill -KILL >/dev/null 2>&1 || true',
    'lsof -ti :3004 | xargs -r kill -KILL >/dev/null 2>&1 || true',
    // Wait until no conflicting processes remain.
    'for i in 1 2 3 4 5 6 7 8 9 10; do',
    '  if ! pgrep -f "pnpm -F @enzo/api start" >/dev/null 2>&1 && ! pgrep -f "pnpm -F @enzo/telegram start" >/dev/null 2>&1; then',
    '    break',
    '  fi',
    '  echo "[$(date -Iseconds)] waiting residual processes to exit..." >> "$LOG"',
    '  sleep 2',
    'done',
    `cd ${qRoot}`,
    'echo "[$(date -Iseconds)] launching new supervisor" >> "$LOG"',
    'ENZO_SKIP_SUPERVISOR_GUARD=1 node packages/cli/dist/index.js start >> "$LOG" 2>&1',
  ].join('; ');
  const child = spawn('/bin/sh', ['-c', restartScript], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return {
    kind: 'supervisor',
    userMessage:
      'Reinicio programado: en unos segundos se detendrá el stack actual y volverá a levantar `./enzo start`. ' +
      'El bot puede tardar un momento en volver a responder.',
  };
}
