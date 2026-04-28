import { accessSync, constants, existsSync, statSync } from 'fs';
import os from 'os';
import path from 'path';

function isExecutableFile(filePath: string): boolean {
  try {
    if (!existsSync(filePath)) {
      return false;
    }
    if (statSync(filePath).isDirectory()) {
      return false;
    }
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function uniqPush(out: string[], p: string | undefined): void {
  if (!p?.trim()) {
    return;
  }
  const n = path.normalize(p.trim());
  if (!out.includes(n)) {
    out.push(n);
  }
}

function appendPathDiscoveredShells(out: string[]): void {
  const names = ['sh', 'bash', 'dash'];
  const dirs = process.env.PATH?.split(path.delimiter).filter(Boolean) ?? [];
  for (const dir of dirs) {
    for (const name of names) {
      uniqPush(out, path.join(dir, name));
    }
  }
}

function posixPathCandidates(): string[] {
  const out: string[] = [];
  uniqPush(out, process.env.ENZO_SHELL);
  uniqPush(out, process.env.SHELL);

  // PATH second: Nix, custom layouts, containers often only expose sh under PATH-derived paths.
  appendPathDiscoveredShells(out);

  const fixed = [
    '/bin/sh',
    '/usr/bin/sh',
    '/bin/bash',
    '/usr/bin/bash',
    '/usr/local/bin/bash',
    '/opt/homebrew/bin/bash',
    '/bin/dash',
    '/usr/bin/dash',
  ];
  for (const p of fixed) {
    uniqPush(out, p);
  }

  return out;
}

/**
 * Ordered list of plausible shell binaries for this OS.
 * `spawn(shell, …)` may still ENOENT paths that stat true in odd sandboxes —
 * callers should retry with the next candidate on ENOENT.
 */
export function shellExecutableCandidates(): string[] {
  if (os.platform() === 'win32') {
    const out: string[] = [];
    uniqPush(out, process.env.ENZO_SHELL);
    uniqPush(out, process.env.ComSpec);
    uniqPush(out, 'C:\\Windows\\System32\\cmd.exe');
    uniqPush(out, 'cmd.exe');
    return out;
  }
  return posixPathCandidates();
}

export function pickFirstResolvableShellExecutable(): string | undefined {
  for (const candidate of shellExecutableCandidates()) {
    if (candidate === 'cmd.exe') {
      return candidate;
    }
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return os.platform() === 'win32' ? 'cmd.exe' : undefined;
}
