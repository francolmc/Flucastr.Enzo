import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { scheduleEnzoSupervisorRestart } from '@enzo/core';

interface VersionInfo {
  current: string;
  available: string;
  commitsBehind: number;
  lastCommitDate: string;
  branch: string;
  isUpToDate: boolean;
}

interface UpdateProgress {
  step: number;
  total: number;
  message: string;
  status: 'running' | 'done' | 'error';
}

export function createSystemRouter(): Router {
  const router = Router();
  let wss: WebSocketServer | null = null;

  function getCurrentVersion(): string {
    try {
      const rootPath = '/Users/franco/Codes/flucastr/Flucastr.Enzo/package.json';
      const apiPath = process.cwd() + '/package.json';
      const pathsToTry = [rootPath, apiPath, '/package.json'];
      for (const p of pathsToTry) {
        if (fs.existsSync(p)) {
          const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
          return pkg.version || '0.1.0';
        }
      }
    } catch (e) {
      console.error('[getCurrentVersion] error:', e);
    }
    return '0.1.0';
  }

  async function getLatestVersionFromGit(): Promise<{ version: string; date: string }> {
    console.log('[getLatestVersionFromGit] spawning git ls-remote --tags origin');
    return new Promise((resolve) => {
      const child = spawn('git', ['ls-remote', '--tags', 'origin'], {
        cwd: process.cwd(),
        shell: true,
      });
      let stdout = '';
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.on('error', (e) => {
        console.log('[getLatestVersionFromGit] error:', e);
        resolve({ version: getCurrentVersion(), date: '' });
      });
      child.on('close', () => {
        console.log('[getLatestVersionFromGit] raw output:', stdout.substring(0, 500));
        const matches = stdout.match(/refs\/tags\/v?(\d+\.\d+\.\d+)/g) || [];
        console.log('[getLatestVersionFromGit] matches:', matches);
        const versions = matches.map((m: string) => m.replace('refs/tags/v', '').replace('refs/tags/', ''));
        console.log('[getLatestVersionFromGit] versions array:', versions, 'length:', versions.length);
        const sorted = [...versions].sort((a, b) => {
          console.log('[sort] comparing:', a, 'vs', b, '=>', b.localeCompare(a));
          return b.localeCompare(a);
        });
        console.log('[getLatestVersionFromGit] sorted:', sorted);
        const latest = sorted[0];
        console.log('[getLatestVersionFromGit] latest version:', latest);
        resolve({ version: latest || getCurrentVersion(), date: '' });
      });
    });
  }

  async function getCommitsBehind(): Promise<number> {
    return new Promise((resolve) => {
      const child = spawn('git', ['rev-list', '--count', 'HEAD..origin/main'], {
        cwd: process.cwd(),
        shell: true,
      });
      let stdout = '';
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.on('error', () => resolve(0));
      child.on('close', () => {
        const count = parseInt(stdout.trim() || '0', 10);
        resolve(isNaN(count) ? 0 : count);
      });
    });
  }

  async function getLastCommitDate(): Promise<string> {
    return new Promise((resolve) => {
      const child = spawn('git', ['log', '-1', '--format=%aI', 'HEAD'], {
        cwd: process.cwd(),
        shell: true,
      });
      let stdout = '';
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.on('error', () => resolve(''));
      child.on('close', () => resolve(stdout.trim()));
    });
  }

  function broadcastProgress(clients: Set<WebSocket>, progress: UpdateProgress) {
    const message = JSON.stringify({ type: 'update-progress', ...progress });
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  function setupWebSocket(server: http.Server) {
    if (wss) return;
    wss = new WebSocketServer({ server, path: '/ws/update' });
    const clients = new Set<WebSocket>();
    wss.on('connection', (ws) => {
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));
    });
  }

  router.get('/api/system/version', async (req: Request, res: Response) => {
    try {
      const [current, latest, commitsBehind, lastCommitDate] = await Promise.all([
        Promise.resolve(getCurrentVersion()),
        getLatestVersionFromGit(),
        getCommitsBehind(),
        getLastCommitDate(),
      ]);

      const versionInfo: VersionInfo = {
        current,
        available: latest.version,
        commitsBehind,
        lastCommitDate,
        branch: 'main',
        isUpToDate: commitsBehind === 0,
      };

      res.json(versionInfo);
    } catch (error) {
      console.error('[GET /api/system/version] error:', error);
      res.status(500).json({ error: 'VersionError', message: 'Failed to get version info' });
    }
  });

  router.post('/api/system/update', async (req: Request, res: Response) => {
    const server = (req.app as any).server;
    if (!server) {
      res.status(500).json({ error: 'ServerError', message: 'Server reference not available' });
      return;
    }

    setupWebSocket(server);

    const clients = new Set<WebSocket>();
    if (wss) {
      wss.clients.forEach((client) => clients.add(client));
    }

    try {
      broadcastProgress(clients, { step: 1, total: 4, message: 'Guardando configuracion...', status: 'running' });

      const configPath = path.join(process.env.HOME || '', '.enzo', 'config.json');
      let configBackup = '';
      if (fs.existsSync(configPath)) {
        configBackup = fs.readFileSync(configPath, 'utf8');
        fs.writeFileSync(configPath + '.backup', configBackup);
      }

      broadcastProgress(clients, { step: 1, total: 4, message: 'Descargando cambios (git pull)...', status: 'done' });
      broadcastProgress(clients, { step: 2, total: 4, message: 'Descargando cambios (git pull)...', status: 'running' });

      await runCommand('git', ['pull', '--ff-only', 'origin', 'main']);

      broadcastProgress(clients, { step: 2, total: 4, message: 'Instalando dependencias (pnpm install)...', status: 'done' });
      broadcastProgress(clients, { step: 3, total: 4, message: 'Instalando dependencias (pnpm install)...', status: 'running' });

      await runCommand('pnpm', ['install', '--frozen-lockfile']);

      broadcastProgress(clients, { step: 3, total: 4, message: 'Compilando...', status: 'done' });
      broadcastProgress(clients, { step: 4, total: 4, message: 'Compilando...', status: 'running' });

      await runCommand('pnpm', ['build']);

      broadcastProgress(clients, { step: 4, total: 4, message: 'Reiniciando servidor...', status: 'running' });

      const restart = scheduleEnzoSupervisorRestart({ cwd: process.cwd() });
      broadcastProgress(clients, { step: 4, total: 4, message: restart.userMessage, status: 'done' });

      res.json({ success: true, message: 'Update completed successfully', needsReload: true });
    } catch (error) {
      try {
        broadcastProgress(clients, { step: 0, total: 4, message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`, status: 'error' });
      } catch {}

      const configPath = path.join(process.env.HOME || '', '.enzo', 'config.json');
      if (fs.existsSync(configPath + '.backup')) {
        fs.copyFileSync(configPath + '.backup', configPath);
        fs.unlinkSync(configPath + '.backup');
      }

      res.status(500).json({ error: 'UpdateError', message: error instanceof Error ? error.message : 'Update failed' });
    }
  });

  return router;
}

function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: process.cwd(),
      stdio: 'pipe',
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed: ${cmd} ${args.join(' ')}${stderr ? `: ${stderr}` : ''}`));
    });
  });
}