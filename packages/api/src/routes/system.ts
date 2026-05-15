import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

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
        isUpToDate: current === latest.version,
      };

      res.json(versionInfo);
    } catch (error) {
      console.error('[GET /api/system/version] error:', error);
      res.status(500).json({ error: 'VersionError', message: 'Failed to get version info' });
    }
  });

  router.post('/api/system/update', async (req: Request, res: Response) => {
    const rootDir = path.resolve(process.cwd(), '..');
    const scriptPath = path.join(rootDir, 'scripts', 'update.sh');

    if (!fs.existsSync(scriptPath)) {
      res.status(500).json({ error: 'UpdateScript', message: 'update.sh script not found at ' + scriptPath });
      return;
    }

    try {
      const child = spawn('sh', [scriptPath], {
        cwd: rootDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      child.unref();

      res.json({ success: true, message: 'Update started in background', needsReload: true });
    } catch (error) {
      res.status(500).json({ error: 'UpdateError', message: error instanceof Error ? error.message : 'Update failed' });
    }
  });

  return router;
}