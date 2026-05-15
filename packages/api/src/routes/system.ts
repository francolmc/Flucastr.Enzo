import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

interface VersionInfo {
  current: string;
  available: string;
  commitsBehind: number;
  lastCommitDate: string;
  branch: string;
  isUpToDate: boolean;
}

export function createSystemRouter(): Router {
  const router = Router();

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const ENZO_ROOT = path.resolve(__dirname, '../../..');
  const SENTINEL = '/tmp/enzo-update-requested';
  const PROGRESS_FILE = '/tmp/enzo-update-progress';

  function getCurrentVersion(): string {
    try {
      const rootPath = path.join(ENZO_ROOT, 'package.json');
      const apiPath = process.cwd() + '/package.json';
      const pathsToTry = [rootPath, apiPath, '/package.json'];
      for (const p of pathsToTry) {
        if (fs.existsSync(p)) {
          const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
          return pkg.version || '0.1.0';
        }
      }
    } catch {}
    return '0.1.0';
  }

  async function getLatestVersionFromGit(): Promise<{ version: string; date: string }> {
    return new Promise((resolve) => {
      const child = spawn('git', ['ls-remote', '--tags', 'origin'], {
        cwd: process.cwd(),
        shell: true,
      });
      let stdout = '';
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.on('error', () => resolve({ version: getCurrentVersion(), date: '' }));
      child.on('close', () => {
        const matches = stdout.match(/refs\/tags\/v?(\d+\.\d+\.\d+)/g) || [];
        const versions = matches.map((m: string) => m.replace('refs/tags/v', '').replace('refs/tags/', ''));
        const sorted = [...versions].sort((a, b) => b.localeCompare(a));
        const latest = sorted[0];
        resolve({ version: latest || getCurrentVersion(), date: '' });
      });
    });
  }

  async function getCommitsBehind(): Promise<number> {
    return new Promise((resolve) => {
      const fetch = spawn('git', ['fetch', 'origin', 'main', '--quiet'], {
        cwd: process.cwd(),
        shell: true,
      });
      fetch.on('close', () => {
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
    try {
      fs.writeFileSync(SENTINEL, new Date().toISOString());
      res.json({ success: true, message: 'Update requested', needsReload: true });
    } catch (error) {
      res.status(500).json({
        error: 'UpdateError',
        message: error instanceof Error ? error.message : 'Failed to request update'
      });
    }
  });

  router.get('/api/system/update/progress', (req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const sendProgress = () => {
      if (!fs.existsSync(PROGRESS_FILE)) {
        res.write(`data: ${JSON.stringify({ status: 'idle' })}\n\n`);
        return;
      }
      const content = fs.readFileSync(PROGRESS_FILE, 'utf-8').trim();

      if (content.startsWith('STEP:')) {
        const [, step, total, message] = content.split(':');
        res.write(`data: ${JSON.stringify({ status: 'running', step: Number(step), total: Number(total), message })}\n\n`);
      } else if (content.startsWith('DONE:')) {
        res.write(`data: ${JSON.stringify({ status: 'done', message: content.slice(5) })}\n\n`);
      } else if (content.startsWith('ERROR:')) {
        res.write(`data: ${JSON.stringify({ status: 'error', message: content.slice(6) })}\n\n`);
      } else if (content.startsWith('RESTARTING:')) {
        res.write(`data: ${JSON.stringify({ status: 'restarting', message: content.slice(11) })}\n\n`);
      }
    };

    const interval = setInterval(sendProgress, 1000);
    req.on('close', () => clearInterval(interval));
  });

  return router;
}