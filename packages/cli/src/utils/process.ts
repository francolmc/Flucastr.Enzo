// @ts-ignore
import { spawn, ChildProcess } from 'child_process';
// @ts-ignore
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
// @ts-ignore
import { resolve } from 'path';

export interface ServiceHandles {
  api?: ChildProcess;
  telegram?: ChildProcess;
}

export interface ServiceStatus {
  api: boolean;
  telegram: boolean;
  uptime?: string;
}

const PIDS_FILE = resolve(process.cwd(), '.enzo-pids.json');

export function startServices(apiEnabled: boolean = true, telegramEnabled: boolean = false): ServiceHandles {
  const handles: ServiceHandles = {};

  if (apiEnabled) {
    handles.api = spawn('pnpm', ['-F', '@enzo/api', 'start'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: true,
    });

    if (handles.api && handles.api.pid) {
      console.log(`🚀 API iniciado (PID: ${handles.api.pid})`);
    }
  }

  if (telegramEnabled) {
    handles.telegram = spawn('pnpm', ['-F', '@enzo/telegram', 'start'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: true,
    });

    if (handles.telegram && handles.telegram.pid) {
      console.log(`🤖 Telegram iniciado (PID: ${handles.telegram.pid})`);
    }
  }

  savePids(handles);
  return handles;
}

export function stopServices(handles: ServiceHandles): void {
  if (handles.api) {
    handles.api.kill('SIGTERM');
    console.log('⏹️  API detenido');
  }

  if (handles.telegram) {
    handles.telegram.kill('SIGTERM');
    console.log('⏹️  Telegram detenido');
  }

  clearPids();
}

export function getServiceStatus(): ServiceStatus {
  try {
    const pids = readPids();
    return {
      api: pids.api ? isProcessRunning(pids.api) : false,
      telegram: pids.telegram ? isProcessRunning(pids.telegram) : false,
    };
  } catch {
    return { api: false, telegram: false };
  }
}

function savePids(handles: ServiceHandles): void {
  const pids = {
    api: handles.api?.pid,
    telegram: handles.telegram?.pid,
    timestamp: new Date().toISOString(),
  };

  writeFileSync(PIDS_FILE, JSON.stringify(pids, null, 2), 'utf-8');
}

function readPids(): { api?: number; telegram?: number } {
  try {
    const content = readFileSync(PIDS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function clearPids(): void {
  try {
    unlinkSync(PIDS_FILE);
  } catch {
    // File doesn't exist
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    // @ts-ignore
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
