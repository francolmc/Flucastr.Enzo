import fs from 'node:fs/promises';
import {
  declarativeJobSchema,
  RESERVED_BUILTIN_ECHO_IDS,
  type DeclarativeEchoJob,
} from '@enzo/core';

export type EchoConfigOnDisk = {
  tasks?: Record<string, { enabled?: boolean; schedule?: string }>;
  declarativeJobs?: unknown[];
  cronTimezone?: string;
};

/** Alineado con EchoEngine DEFAULT_TEMPLATE — solo si el archivo no existe aún. */
const CONFIG_FALLBACK_WHEN_MISSING: EchoConfigOnDisk = {
  tasks: {
    'morning-briefing': { enabled: true, schedule: '0 7 * * *' },
    'context-refresh': { enabled: true, schedule: 'interval:120min' },
    'night-summary': { enabled: true, schedule: '30 22 * * *' },
  },
  declarativeJobs: [],
};

function isEnoent(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as NodeJS.ErrnoException).code === 'ENOENT';
}

async function readConfig(configPath: string): Promise<EchoConfigOnDisk> {
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as EchoConfigOnDisk;
    }
    return {};
  } catch (e) {
    if (isEnoent(e)) {
      return structuredClone(CONFIG_FALLBACK_WHEN_MISSING) as EchoConfigOnDisk;
    }
    throw e;
  }
}

async function writeConfig(configPath: string, cfg: EchoConfigOnDisk): Promise<void> {
  const text = `${JSON.stringify(cfg, null, 2)}\n`;
  await fs.writeFile(configPath, text, 'utf-8');
}

function parseDeclarativeJobsList(raw: unknown): {
  jobs: DeclarativeEchoJob[];
  invalid: { index: number; summary: string }[];
} {
  const list = Array.isArray(raw) ? raw : [];
  const jobs: DeclarativeEchoJob[] = [];
  const invalid: { index: number; summary: string }[] = [];
  list.forEach((row, index) => {
    const parsed = declarativeJobSchema.safeParse(row);
    if (parsed.success) {
      jobs.push(parsed.data);
    } else {
      invalid.push({
        index,
        summary: JSON.stringify(parsed.error.flatten().fieldErrors ?? parsed.error.message),
      });
    }
  });
  return { jobs, invalid };
}

export async function getEchoDeclarativeJobsState(configPath: string): Promise<{
  jobs: DeclarativeEchoJob[];
  cronTimezone?: string;
  invalidDeclarativeEntries: { index: number; summary: string }[];
}> {
  const cfg = await readConfig(configPath);
  const parsed = parseDeclarativeJobsList(cfg.declarativeJobs);
  const tz = typeof cfg.cronTimezone === 'string' && cfg.cronTimezone.trim().length > 0 ? cfg.cronTimezone.trim() : undefined;
  return {
    jobs: parsed.jobs,
    cronTimezone: tz,
    invalidDeclarativeEntries: parsed.invalid,
  };
}

/** Persiste enabled en `tasks.<id>` para que sobreviva al reload del watcher. */
export async function persistEchoTaskEnabled(
  configPath: string,
  taskId: string,
  enabled: boolean
): Promise<void> {
  const cfg = await readConfig(configPath);
  cfg.tasks = { ...(cfg.tasks ?? {}) };
  cfg.tasks[taskId] = {
    ...(cfg.tasks[taskId] ?? {}),
    enabled,
  };
  await writeConfig(configPath, cfg);
}

export async function persistCronTimezone(configPath: string, cronTimezone: string | undefined): Promise<void> {
  const cfg = await readConfig(configPath);
  const trimmed = cronTimezone?.trim();
  if (trimmed && trimmed.length > 0) {
    cfg.cronTimezone = trimmed;
  } else {
    delete cfg.cronTimezone;
  }
  await writeConfig(configPath, cfg);
}

export async function createDeclarativeJobOnDisk(configPath: string, job: unknown): Promise<DeclarativeEchoJob> {
  const parsed = declarativeJobSchema.safeParse(job);
  if (!parsed.success) {
    const err = new Error('VALIDATION_ERROR');
    (err as Error & { zodIssues?: unknown }).zodIssues = parsed.error.flatten();
    throw err;
  }
  const data = parsed.data;
  if (RESERVED_BUILTIN_ECHO_IDS.has(data.id)) {
    throw Object.assign(new Error('ID reservado para tareas integradas'), { code: 'RESERVED_ID' });
  }

  const cfg = await readConfig(configPath);
  const { jobs } = parseDeclarativeJobsList(cfg.declarativeJobs);
  if (jobs.some((j) => j.id === data.id)) {
    throw Object.assign(new Error(`Ya existe un job declarativo con id "${data.id}"`), { code: 'DUPLICATE_ID' });
  }

  const rawList = Array.isArray(cfg.declarativeJobs) ? [...cfg.declarativeJobs] : [];
  cfg.declarativeJobs = [...rawList, data];
  await writeConfig(configPath, cfg);
  return data;
}

export async function updateDeclarativeJobOnDisk(
  configPath: string,
  id: string,
  job: unknown
): Promise<DeclarativeEchoJob> {
  const parsed = declarativeJobSchema.safeParse(job);
  if (!parsed.success) {
    const err = new Error('VALIDATION_ERROR');
    (err as Error & { zodIssues?: unknown }).zodIssues = parsed.error.flatten();
    throw err;
  }
  const data = parsed.data;
  if (data.id !== id) {
    throw Object.assign(new Error('El id del cuerpo debe coincidir con la URL'), { code: 'ID_MISMATCH' });
  }
  if (RESERVED_BUILTIN_ECHO_IDS.has(data.id)) {
    throw Object.assign(new Error('ID reservado'), { code: 'RESERVED_ID' });
  }

  const cfg = await readConfig(configPath);
  const list = Array.isArray(cfg.declarativeJobs) ? [...cfg.declarativeJobs] : [];
  let found = false;
  const next = list.map((row) => {
    const p = declarativeJobSchema.safeParse(row);
    if (p.success && p.data.id === id) {
      found = true;
      return data;
    }
    return row;
  });
  if (!found) {
    throw Object.assign(new Error(`Job declarativo no encontrado: ${id}`), { code: 'NOT_FOUND' });
  }
  cfg.declarativeJobs = next;
  await writeConfig(configPath, cfg);
  return data;
}

export async function deleteDeclarativeJobOnDisk(configPath: string, id: string): Promise<void> {
  if (RESERVED_BUILTIN_ECHO_IDS.has(id)) {
    throw Object.assign(new Error('No se puede borrar una tarea integrada'), { code: 'RESERVED_ID' });
  }
  const cfg = await readConfig(configPath);
  const list = Array.isArray(cfg.declarativeJobs) ? [...cfg.declarativeJobs] : [];
  const next = list.filter((row) => {
    const p = declarativeJobSchema.safeParse(row);
    return !(p.success && p.data.id === id);
  });
  const removed = next.length !== list.length;
  if (!removed) {
    throw Object.assign(new Error(`Job declarativo no encontrado: ${id}`), { code: 'NOT_FOUND' });
  }
  cfg.declarativeJobs = next;
  if (cfg.tasks?.[id]) {
    cfg.tasks = { ...cfg.tasks };
    delete cfg.tasks[id];
  }
  await writeConfig(configPath, cfg);
}
