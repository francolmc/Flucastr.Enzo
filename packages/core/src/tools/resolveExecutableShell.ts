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

/** Snap (and similar) shim paths often stat as executable yet spawn ENOENT outside snap confinement — try them last. */
function isSnapOrSimilarShim(shellPath: string): boolean {
  const n = path.normalize(shellPath);
  return (
    n.startsWith('/snap/') ||
    n.startsWith('/var/lib/snapd/') ||
    n.startsWith('/snapd/')
  );
}

/** Prefer distro / posix paths; append snap-derived shells after (still retried if needed). */
function prioritizeNonSnapShells(entries: string[]): string[] {
  const preferred: string[] = [];
  const deferred: string[] = [];
  for (const e of entries) {
    if (isSnapOrSimilarShim(e)) {
      deferred.push(e);
    } else {
      preferred.push(e);
    }
  }
  return [...preferred, ...deferred];
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
  uniqPush(out, process.env.ENZO_SHELL);

  // Standard paths first (/bin/sh) — fast on typical linux; then PATH (Nix, etc.); lastly $SHELL when actually executable here.
  appendStandardPosixFallbacks(out);
  appendPathDiscoveredShells(out);

  const shellEnv = process.env.SHELL?.trim();
  if (shellEnv && shellEnv !== process.env.ENZO_SHELL?.trim() && isExecutableFile(path.normalize(shellEnv))) {
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
  return prioritizeNonSnapShells(posixPathCandidates());
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
