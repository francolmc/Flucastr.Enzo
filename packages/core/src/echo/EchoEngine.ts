import { watch, type FSWatcher } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import cron from 'node-cron';
import {
  createDeclarativeOrchestratorAction,
  declarativeJobSchema,
  RESERVED_BUILTIN_ECHO_IDS,
  type DeclarativeEchoJob,
} from './DeclarativeEchoJobs.js';
import type { EchoOrchestratorBinding } from './EchoOrchestrationBinding.js';
import { computeCronNextRunUtcDate } from './cronNextRun.js';
import type { ConfigService } from '../config/ConfigService.js';

export interface EchoTask {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
  action: () => Promise<EchoResult>;
  /** Declarativas desde `echo.config.json`; las built-in no suelen setear esto. */
  taskKind?: 'builtin' | 'declarative';
}

export interface EchoResult {
  success: boolean;
  message?: string;
  notified?: boolean;
  error?: string;
}

export interface EchoDiagnostics {
  processId: number;
  configPath: string;
  /** TZ IANA opcional en echo.config.json para calcular próximos cron. */
  cronTimezoneConfigured?: string;
  /** Resumen de TZ del proceso (variable TZ o inferida). */
  processTimezoneLabel: string;
  utcOffsetMinutes: number;
  /** `api` | `telegram` | `unknown` vía ENZO_RUNTIME_ROLE. */
  runtimeRole: string;
  /** True si hay owner o allowed users para resolver userId de Echo. */
  echoTargetUserConfigured: boolean;
  /** Hay callback de Orchestrator para jobs `orchestrator_message`. */
  orchestratorBoundForDeclarative: boolean;
  /** Si API y Telegram corren a la vez, ambos disparan Echo: conviene un solo rol con Echo. */
  duplicateEchoWarning?: string;
}

export interface EchoEngineStatus {
  running: boolean;
  tasks: Array<{
    id: string;
    name: string;
    enabled: boolean;
    schedule: string;
    lastRun?: Date;
    nextRun?: Date;
    lastResult?: EchoResult;
    taskKind?: 'builtin' | 'declarative';
  }>;
  diagnostics: EchoDiagnostics;
}

type EchoTaskConfig = {
  enabled?: boolean;
  schedule?: string;
};

type EchoConfig = {
  tasks?: Record<string, EchoTaskConfig>;
  /** Jobs declarativos (JSON); ver esquema en DeclarativeEchoJobs. */
  declarativeJobs?: unknown[];
  /** Zona IANA para `computeCronNextRunUtcDate` y alineación con expectativas del usuario. */
  cronTimezone?: string;
};

interface RegisteredTask {
  task: EchoTask;
  lastResult?: EchoResult;
  activeSchedule: string;
}

interface EchoEngineOptions {
  configPath?: string;
  taskTimeoutMs?: number;
  configService?: ConfigService;
}

interface QueueEntry {
  taskId: string;
  resolve: (result: EchoResult) => void;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_TEMPLATE: EchoConfig = {
  tasks: {},
  declarativeJobs: [],
};

function isDebugEnabled(): boolean {
  return (process.env.ENZO_DEBUG || '').toLowerCase() === 'true';
}

function debugLog(message: string, details?: unknown): void {
  if (!isDebugEnabled()) {
    return;
  }
  if (details === undefined) {
    console.log(`[EchoEngine] ${message}`);
    return;
  }
  console.log(`[EchoEngine] ${message}`, details);
}

function processTimezoneLabel(): string {
  const tz = process.env.TZ?.trim();
  if (tz) {
    return tz;
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'system';
  } catch {
    return 'system';
  }
}

export class EchoEngine {
  private readonly tasks = new Map<string, RegisteredTask>();
  private readonly cronJobs = new Map<string, ReturnType<typeof cron.schedule>>();
  private readonly intervalJobs = new Map<string, NodeJS.Timeout>();
  private readonly queue: QueueEntry[] = [];
  private readonly configPath: string;
  private readonly taskTimeoutMs: number;
  private readonly configService?: ConfigService;
  private configWatcher: FSWatcher | null = null;
  private running = false;
  private processingQueue = false;
  private stopping = false;
  private reloadTimer: NodeJS.Timeout | null = null;
  private declarativeJobIds = new Set<string>();
  private orchestratorBinding: EchoOrchestratorBinding | null = null;
  private diagnosticsExtras: () => Partial<Pick<EchoDiagnostics, 'echoTargetUserConfigured' | 'duplicateEchoWarning'>> =
    () => ({});
  private lastConfigCronTimezone: string | undefined;

  constructor(options: EchoEngineOptions = {}) {
    this.configPath = options.configPath ?? path.join(homedir(), '.enzo', 'echo.config.json');
    this.taskTimeoutMs = options.taskTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.configService = options.configService;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  /** Recarga `echo.config.json` de inmediato (p. ej. tras escribir desde la API). */
  async reloadConfigNow(): Promise<void> {
    await this.reloadFromConfig();
  }

  /** Enlaza Orchestrator y memoria para jobs `orchestrator_message` (llamar desde API / Telegram tras crear Orchestrator). */
  setOrchestratorBinding(binding: EchoOrchestratorBinding | null): void {
    this.orchestratorBinding = binding;
    void this.reloadFromConfig();
  }

  setDiagnosticsExtras(
    fn: () => Partial<Pick<EchoDiagnostics, 'echoTargetUserConfigured' | 'duplicateEchoWarning'>>
  ): void {
    this.diagnosticsExtras = fn;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.stopping = false;
    void this.initialize();
  }

  stop(): void {
    this.running = false;
    this.stopping = true;
    this.clearSchedules();
    if (this.configWatcher) {
      this.configWatcher.close();
      this.configWatcher = null;
    }
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    const pending = this.queue.splice(0, this.queue.length);
    for (const entry of pending) {
      entry.resolve({ success: false, error: 'Echo engine stopped' });
    }
  }

  registerTask(task: EchoTask, options?: { skipReload?: boolean }): void {
    const existing = this.tasks.get(task.id);
    const mergedTask: EchoTask = {
      ...task,
      lastRun: task.lastRun ?? existing?.task.lastRun,
      nextRun: task.nextRun ?? existing?.task.nextRun,
      taskKind: task.taskKind ?? existing?.task.taskKind ?? 'builtin',
    };
    this.tasks.set(task.id, {
      task: mergedTask,
      lastResult: existing?.lastResult,
      activeSchedule: mergedTask.schedule,
    });
    if (this.running && !options?.skipReload) {
      void this.reloadFromConfig();
    }
  }

  disableTask(id: string): void {
    const registered = this.tasks.get(id);
    if (!registered) {
      return;
    }
    registered.task.enabled = false;
    this.teardownTask(id);
    registered.task.nextRun = undefined;
  }

  enableTask(id: string): void {
    const registered = this.tasks.get(id);
    if (!registered) {
      return;
    }
    registered.task.enabled = true;
    if (this.running) {
      this.setupTask(id, registered);
      this.refreshCronNextRunIfNeeded(id, registered);
    }
  }

  getStatus(): EchoEngineStatus {
    const extra = this.diagnosticsExtras();
    const diagnostics: EchoDiagnostics = {
      processId: process.pid,
      configPath: this.configPath,
      cronTimezoneConfigured: this.lastConfigCronTimezone,
      processTimezoneLabel: processTimezoneLabel(),
      utcOffsetMinutes: -new Date().getTimezoneOffset(),
      runtimeRole: process.env.ENZO_RUNTIME_ROLE?.trim() || 'unknown',
      echoTargetUserConfigured: extra.echoTargetUserConfigured ?? false,
      orchestratorBoundForDeclarative: Boolean(
        this.orchestratorBinding?.process && this.orchestratorBinding?.memoryService
      ),
      duplicateEchoWarning: extra.duplicateEchoWarning,
    };

    return {
      running: this.running,
      diagnostics,
      tasks: Array.from(this.tasks.values()).map(({ task, lastResult, activeSchedule }) => ({
        id: task.id,
        name: task.name,
        enabled: task.enabled,
        schedule: activeSchedule,
        lastRun: task.lastRun,
        nextRun: task.nextRun,
        lastResult,
        taskKind: task.taskKind,
      })),
    };
  }

  async runNow(taskId: string): Promise<EchoResult> {
    if (!this.tasks.has(taskId)) {
      return { success: false, error: `Task not found: ${taskId}` };
    }
    return this.enqueueTask(taskId);
  }

  private async initialize(): Promise<void> {
    try {
      await this.ensureConfigTemplate();
      await this.reloadFromConfig();
      this.watchConfigFile();
    } catch (error) {
      debugLog('Initialization failed', error);
    }
  }

  private async ensureConfigTemplate(): Promise<void> {
    const configDir = path.dirname(this.configPath);
    await fs.mkdir(configDir, { recursive: true });
    try {
      await fs.access(this.configPath);
    } catch {
      await fs.writeFile(this.configPath, `${JSON.stringify(DEFAULT_TEMPLATE, null, 2)}\n`, 'utf-8');
    }
  }

  private watchConfigFile(): void {
    if (this.configWatcher) {
      this.configWatcher.close();
      this.configWatcher = null;
    }
    try {
      this.configWatcher = watch(this.configPath, () => {
        if (this.reloadTimer) {
          clearTimeout(this.reloadTimer);
        }
        this.reloadTimer = setTimeout(() => {
          void this.reloadFromConfig();
        }, 150);
      });
    } catch (error) {
      debugLog('Unable to watch echo config file', error);
    }
  }

  private buildDeclarativeBinding(): EchoOrchestratorBinding {
    const b = this.orchestratorBinding;
    return {
      process: b?.process,
      memoryService: b?.memoryService,
      resolveEchoUserId: b?.resolveEchoUserId,
      notificationGateway: b?.notificationGateway,
      buildRuntimeHints: b?.buildRuntimeHints,
    };
  }

  private syncDeclarativeJobsFromConfig(config: EchoConfig): void {
    const rawList = Array.isArray(config.declarativeJobs) ? config.declarativeJobs : [];
    const validJobs: DeclarativeEchoJob[] = [];
    for (const row of rawList) {
      const parsed = declarativeJobSchema.safeParse(row);
      if (!parsed.success) {
        debugLog('Invalid declarativeJobs entry skipped', parsed.error.flatten());
        continue;
      }
      if (RESERVED_BUILTIN_ECHO_IDS.has(parsed.data.id)) {
        debugLog('declarativeJobs id conflicts with builtin', parsed.data.id);
        continue;
      }
      validJobs.push(parsed.data);
    }

    const nextIds = new Set(validJobs.map((j) => j.id));
    for (const id of this.declarativeJobIds) {
      if (!nextIds.has(id)) {
        this.teardownTask(id);
        this.tasks.delete(id);
      }
    }
    this.declarativeJobIds = nextIds;

    const bind = this.buildDeclarativeBinding();
    for (const job of validJobs) {
      const taskOverride = config.tasks?.[job.id];
      const enabled =
        typeof taskOverride?.enabled === 'boolean' ? taskOverride.enabled : (job.enabled ?? true);
      const scheduleLine = job.schedule.trim();

      this.registerTask(
        {
          id: job.id,
          name: job.name?.trim() || job.id,
          schedule: scheduleLine,
          enabled,
          taskKind: 'declarative',
          action: createDeclarativeOrchestratorAction(job, bind),
        },
        { skipReload: true }
      );

      const registered = this.tasks.get(job.id);
      if (registered) {
        registered.task.schedule = scheduleLine;
        registered.activeSchedule =
          typeof taskOverride?.schedule === 'string' && taskOverride.schedule.trim().length > 0
            ? taskOverride.schedule.trim()
            : scheduleLine;
        registered.task.enabled = enabled;
      }
    }
  }

  private async reloadFromConfig(): Promise<void> {
    const config = await this.readConfig();
    this.lastConfigCronTimezone = config.cronTimezone?.trim() || undefined;
    this.syncDeclarativeJobsFromConfig(config);

    for (const [taskId, registered] of this.tasks.entries()) {
      const override = config.tasks?.[taskId];
      if (override && typeof override.enabled === 'boolean') {
        registered.task.enabled = override.enabled;
      }
      if (override && typeof override.schedule === 'string' && override.schedule.trim().length > 0) {
        registered.activeSchedule = override.schedule.trim();
      } else {
        registered.activeSchedule = registered.task.schedule;
      }

      if (registered.task.taskKind === 'declarative' && this.declarativeJobIds.has(taskId)) {
        const bind = this.buildDeclarativeBinding();
        const rawList = Array.isArray(config.declarativeJobs) ? config.declarativeJobs : [];
        for (const r of rawList) {
          const parsed = declarativeJobSchema.safeParse(r);
          if (parsed.success && parsed.data.id === taskId) {
            registered.task.action = createDeclarativeOrchestratorAction(parsed.data, bind);
            break;
          }
        }
      }

      this.teardownTask(taskId);
      if (this.running && registered.task.enabled) {
        this.setupTask(taskId, registered);
        this.refreshCronNextRunIfNeeded(taskId, registered);
      } else {
        registered.task.nextRun = undefined;
      }
    }
  }

  private async readConfig(): Promise<EchoConfig> {
    try {
      const raw = await fs.readFile(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw) as EchoConfig;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      debugLog('Failed to read echo config, using defaults', error);
      return {};
    }
  }

  private refreshCronNextRunIfNeeded(taskId: string, registered: RegisteredTask): void {
    const schedule = registered.activeSchedule;
    if (!this.running || !registered.task.enabled) {
      return;
    }
    if (schedule.startsWith('interval:')) {
      return;
    }
    if (!cron.validate(schedule)) {
      return;
    }
    const from = registered.task.lastRun ?? new Date();
    const tz = this.lastConfigCronTimezone;
    const next = computeCronNextRunUtcDate(schedule, tz ? { tz, fromDate: from } : { fromDate: from });
    if (next) {
      registered.task.nextRun = next;
    }
  }

  private setupTask(taskId: string, registered: RegisteredTask): void {
    const schedule = registered.activeSchedule;
    if (schedule.startsWith('interval:')) {
      const intervalMs = this.parseIntervalMs(schedule);
      if (!intervalMs) {
        debugLog(`Invalid interval schedule for task ${taskId}: ${schedule}`);
        return;
      }
      const timer = setInterval(() => {
        void this.enqueueTask(taskId);
      }, intervalMs);
      this.intervalJobs.set(taskId, timer);
      registered.task.nextRun = new Date(Date.now() + intervalMs);
      return;
    }

    if (!cron.validate(schedule)) {
      debugLog(`Invalid cron schedule for task ${taskId}: ${schedule}`);
      return;
    }

    const job = cron.schedule(schedule, () => {
      void this.enqueueTask(taskId);
    });
    this.cronJobs.set(taskId, job);
    this.refreshCronNextRunIfNeeded(taskId, registered);
  }

  private teardownTask(taskId: string): void {
    const cronJob = this.cronJobs.get(taskId);
    if (cronJob) {
      cronJob.stop();
      this.cronJobs.delete(taskId);
    }
    const intervalJob = this.intervalJobs.get(taskId);
    if (intervalJob) {
      clearInterval(intervalJob);
      this.intervalJobs.delete(taskId);
    }
  }

  private clearSchedules(): void {
    for (const taskId of this.cronJobs.keys()) {
      this.teardownTask(taskId);
    }
    for (const taskId of this.intervalJobs.keys()) {
      this.teardownTask(taskId);
    }
  }

  private parseIntervalMs(schedule: string): number | null {
    const match = /^interval:(\d+)min$/i.exec(schedule.trim());
    if (!match) {
      return null;
    }
    const minutes = Number(match[1]);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return null;
    }
    return minutes * 60 * 1000;
  }

  private enqueueTask(taskId: string): Promise<EchoResult> {
    return new Promise((resolve) => {
      this.queue.push({ taskId, resolve });
      void this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processingQueue) {
      return;
    }
    this.processingQueue = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift();
        if (!next) {
          continue;
        }
        const result = await this.executeTask(next.taskId);
        next.resolve(result);
      }
    } finally {
      this.processingQueue = false;
      while (this.queue.length > 0) {
        const orphan = this.queue.shift();
        orphan?.resolve({ success: false, error: this.stopping ? 'Echo engine stopped' : 'Task did not run' });
      }
    }
  }

  private async executeTask(taskId: string): Promise<EchoResult> {
    const registered = this.tasks.get(taskId);
    if (!registered) {
      return { success: false, error: `Task not found: ${taskId}` };
    }

    const { task } = registered;
    const startedAt = Date.now();
    let timeoutId: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<EchoResult>((resolve) => {
      timeoutId = setTimeout(() => {
        resolve({
          success: false,
          error: `Task timed out after ${Math.floor(this.taskTimeoutMs / 1000)}s`,
        });
      }, this.taskTimeoutMs);
    });

    const runPromise = (async () => {
      try {
        return await task.action();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message } satisfies EchoResult;
      }
    })();

    const result = await Promise.race([runPromise, timeoutPromise]);
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    task.lastRun = new Date();
    registered.lastResult = result;

    if (task.enabled && registered.activeSchedule.startsWith('interval:')) {
      const nextDelay = this.parseIntervalMs(registered.activeSchedule);
      if (nextDelay) {
        task.nextRun = new Date(Date.now() + nextDelay);
      }
    } else if (task.enabled && !registered.activeSchedule.startsWith('interval:') && cron.validate(registered.activeSchedule)) {
      const tz = this.lastConfigCronTimezone;
      const next = computeCronNextRunUtcDate(
        registered.activeSchedule,
        tz ? { tz, fromDate: task.lastRun } : { fromDate: task.lastRun }
      );
      if (next) {
        task.nextRun = next;
      }
    }

    if (!result.success) {
      debugLog(`Task ${task.id} failed after ${Date.now() - startedAt}ms`, result.error);
    }
    return result;
  }
}
