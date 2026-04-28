import { spawnSync } from 'child_process';
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

const shellSpawnabilityCache = new Map<string, boolean>();

/**
 * A file may exist and be executable yet still fail at execve time (e.g. broken interpreter/loader),
 * which surfaces as ENOENT from Node spawn. Probe once and cache.
 */
function canSpawnShellExecutable(shellPath: string): boolean {
  const n = path.normalize(shellPath);
  const cached = shellSpawnabilityCache.get(n);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'echo ok'] : ['-c', 'true'];
    const r = spawnSync(n, args, { stdio: 'ignore' });
    const ok = !r.error;
    shellSpawnabilityCache.set(n, ok);
    return ok;
  } catch {
    shellSpawnabilityCache.set(n, false);
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

/** Snap shims typically cannot be exec()'d reliably from arbitrary Node systemd services — do not spawn them. */
function isSnapOrSimilarShim(shellPath: string): boolean {
  const n = path.normalize(shellPath);
  return (
    n.startsWith('/snap/') ||
    n.startsWith('/var/lib/snapd/') ||
    n.startsWith('/snapd/')
  );
}

/** WSL mounts Windows drives as /mnt/c/... — PATH often points at broken or non-ELF tools there; skip for spawn. */
function isWslWindowsMountPath(shellPath: string): boolean {
  return /^\/mnt\/[a-zA-Z](\/|$)/.test(path.normalize(shellPath));
}

function shouldSkipShellCandidate(shellPath: string | undefined): boolean {
  if (!shellPath?.trim()) {
    return true;
  }
  const n = path.normalize(shellPath.trim());
  return isSnapOrSimilarShim(n) || isWslWindowsMountPath(n);
}

/** Well-known distro paths first (even if $PATH lists /snap/bin first). */
const PREFERRED_POSIX_SHELL_ORDER = [
  '/bin/sh',
  '/usr/bin/sh',
  '/bin/bash',
  '/usr/bin/bash',
  '/usr/local/bin/bash',
  '/bin/dash',
  '/usr/bin/dash',
];

function mergePreferredShellsFirst(rest: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (p: string): void => {
    const n = path.normalize(p.trim());
    if (!n || seen.has(n)) {
      return;
    }
    seen.add(n);
    out.push(n);
  };

  for (const p of PREFERRED_POSIX_SHELL_ORDER) {
    if (isExecutableFile(p) && canSpawnShellExecutable(p)) {
      push(p);
    }
  }
  for (const p of rest) {
    push(p);
  }
  return out;
}

function appendPathDiscoveredShells(out: string[]): void {
  const names = ['sh', 'bash', 'dash'];
  const dirs = process.env.PATH?.split(path.delimiter).filter(Boolean) ?? [];
  for (const dir of dirs) {
    if (shouldSkipShellCandidate(dir) || dir.includes('/snap/')) {
      continue;
    }
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isExecutableFile(candidate) && canSpawnShellExecutable(candidate)) {
        uniqPush(out, candidate);
      }
    }
  }
}

function appendIfExists(out: string[], candidatePath: string): void {
  const n = path.normalize(candidatePath);
  if (existsSync(n)) {
    uniqPush(out, n);
  }
}

function appendStandardPosixFallbacks(out: string[]): void {
  const fixed = [
    '/bin/sh',
    '/usr/bin/sh',
    '/bin/bash',
    '/usr/bin/bash',
    '/usr/local/bin/bash',
    '/bin/dash',
    '/usr/bin/dash',
  ];
  for (const p of fixed) {
    uniqPush(out, p);
  }
  // Optional installations — only add if present on disk (no OS-specific if/else).
  for (const p of ['/opt/homebrew/bin/bash', '/opt/homebrew/bin/zsh']) {
    appendIfExists(out, p);
  }
}

function posixPathCandidates(): string[] {
  const out: string[] = [];
  const enzoShell = process.env.ENZO_SHELL?.trim();
  if (enzoShell && !shouldSkipShellCandidate(enzoShell)) {
    uniqPush(out, process.env.ENZO_SHELL);
  }

  // Standard paths first (/bin/sh) — fast on typical linux; then PATH (Nix, etc.); lastly $SHELL when actually executable here.
  appendStandardPosixFallbacks(out);
  appendPathDiscoveredShells(out);

  const shellEnv = process.env.SHELL?.trim();
  if (
    shellEnv &&
    shellEnv !== process.env.ENZO_SHELL?.trim() &&
    !shouldSkipShellCandidate(shellEnv) &&
    isExecutableFile(path.normalize(shellEnv)) &&
    canSpawnShellExecutable(path.normalize(shellEnv))
  ) {
    uniqPush(out, shellEnv);
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
  const filtered = posixPathCandidates().filter(
    (p) => !shouldSkipShellCandidate(p) && isExecutableFile(p) && canSpawnShellExecutable(p)
  );
  return mergePreferredShellsFirst(filtered);
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
