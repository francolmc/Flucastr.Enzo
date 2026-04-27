import { watch, type FSWatcher } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import cron from 'node-cron';

export interface EchoTask {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
  action: () => Promise<EchoResult>;
}

export interface EchoResult {
  success: boolean;
  message?: string;
  notified?: boolean;
  error?: string;
}

export interface EchoEngineStatus {
  running: boolean;
  tasks: Array<{
    id: string;
    name: string;
    enabled: boolean;
    lastRun?: Date;
    nextRun?: Date;
    lastResult?: EchoResult;
  }>;
}

type EchoTaskConfig = {
  enabled?: boolean;
  schedule?: string;
};

type EchoConfig = {
  tasks?: Record<string, EchoTaskConfig>;
};

interface RegisteredTask {
  task: EchoTask;
  lastResult?: EchoResult;
  activeSchedule: string;
}

interface EchoEngineOptions {
  configPath?: string;
  taskTimeoutMs?: number;
}

interface QueueEntry {
  taskId: string;
  resolve: (result: EchoResult) => void;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_TEMPLATE: EchoConfig = {
  tasks: {
    'morning-briefing': { enabled: true, schedule: '0 7 * * *' },
    'context-refresh': { enabled: true, schedule: 'interval:120min' },
    'night-summary': { enabled: true, schedule: '30 22 * * *' },
  },
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

export class EchoEngine {
  private readonly tasks = new Map<string, RegisteredTask>();
  private readonly cronJobs = new Map<string, ReturnType<typeof cron.schedule>>();
  private readonly intervalJobs = new Map<string, NodeJS.Timeout>();
  private readonly queue: QueueEntry[] = [];
  private readonly configPath: string;
  private readonly taskTimeoutMs: number;
  private configWatcher: FSWatcher | null = null;
  private running = false;
  private processingQueue = false;
  private stopping = false;
  private reloadTimer: NodeJS.Timeout | null = null;

  constructor(options: EchoEngineOptions = {}) {
    this.configPath = options.configPath ?? path.join(homedir(), '.enzo', 'echo.config.json');
    this.taskTimeoutMs = options.taskTimeoutMs ?? DEFAULT_TIMEOUT_MS;
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
    this.queue.length = 0;
  }

  registerTask(task: EchoTask): void {
    const existing = this.tasks.get(task.id);
    const mergedTask: EchoTask = {
      ...task,
      lastRun: task.lastRun ?? existing?.task.lastRun,
      nextRun: task.nextRun ?? existing?.task.nextRun,
    };
    this.tasks.set(task.id, {
      task: mergedTask,
      lastResult: existing?.lastResult,
      activeSchedule: mergedTask.schedule,
    });
    if (this.running) {
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
    }
  }

  getStatus(): EchoEngineStatus {
    return {
      running: this.running,
      tasks: Array.from(this.tasks.values()).map(({ task, lastResult }) => ({
        id: task.id,
        name: task.name,
        enabled: task.enabled,
        lastRun: task.lastRun,
        nextRun: task.nextRun,
        lastResult,
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

  private async reloadFromConfig(): Promise<void> {
    const config = await this.readConfig();
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
      this.teardownTask(taskId);
      if (this.running && registered.task.enabled) {
        this.setupTask(taskId, registered);
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
    registered.task.nextRun = undefined;
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
        const next = this.queue.shift();
        next?.resolve({ success: false, error: 'Task did not run' });
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
    }

    if (!result.success) {
      debugLog(`Task ${task.id} failed after ${Date.now() - startedAt}ms`, result.error);
    }
    return result;
  }
}
