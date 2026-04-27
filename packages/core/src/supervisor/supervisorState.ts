import { unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

export const ENZO_SUPERVISOR_STATE_FILENAME = '.enzo-supervisor.json';

export interface EnzoSupervisorState {
  /** PID of the `enzo start` (CLI) process that supervises UI + API + Telegram. */
  pid: number;
  /** Repository root (cwd where `pnpm exec enzo start` was run). */
  root: string;
  startedAt: string;
}

export function writeEnzoSupervisorState(repoRoot: string, supervisorPid: number): void {
  const state: EnzoSupervisorState = {
    pid: supervisorPid,
    root: repoRoot,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(join(repoRoot, ENZO_SUPERVISOR_STATE_FILENAME), JSON.stringify(state, null, 2), 'utf-8');
}

export function clearEnzoSupervisorState(repoRoot: string): void {
  try {
    unlinkSync(join(repoRoot, ENZO_SUPERVISOR_STATE_FILENAME));
  } catch {
    // missing file is fine
  }
}
