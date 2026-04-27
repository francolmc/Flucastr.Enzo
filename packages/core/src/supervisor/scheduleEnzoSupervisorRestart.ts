import { spawn } from 'child_process';

export type ScheduleEnzoRestartKind = 'custom_command' | 'skipped';

export interface ScheduleEnzoSupervisorRestartResult {
  kind: ScheduleEnzoRestartKind;
  /** User-facing line(s) for Telegram or logs. */
  userMessage: string;
}

/**
 * After `git pull` + build, restarts the full Enzo stack.
 *
 * Stable mode only:
 * - `ENZO_UPDATE_RESTART_CMD` or `ENZO_RESTART_CMD` (if set): run as a detached shell command
 *   (recommended: `systemctl --user restart enzo`).
 * - Otherwise: do not attempt in-process restarts; caller should surface a clear setup message.
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
        'Reinicio solicitado: se ejecutó ENZO_UPDATE_RESTART_CMD en segundo plano.',
    };
  }

  return {
    kind: 'skipped',
    userMessage:
      'Actualización lista, pero no hay reinicio automático configurado.\n' +
      'Define `ENZO_UPDATE_RESTART_CMD` (recomendado: `systemctl --user restart enzo`) en el entorno del servicio.',
  };
}
