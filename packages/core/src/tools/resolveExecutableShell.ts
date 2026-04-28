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

/** Snap shims typically cannot be exec()'d reliably from arbitrary Node systemd services — do not spawn them. */
function isSnapOrSimilarShim(shellPath: string): boolean {
  const n = path.normalize(shellPath);
  return (
    n.startsWith('/snap/') ||
    n.startsWith('/var/lib/snapd/') ||
    n.startsWith('/snapd/')
  );
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
    if (existsSync(p)) {
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
    if (isSnapOrSimilarShim(dir) || dir.includes('/snap/')) {
      continue;
    }
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
  const enzoShell = process.env.ENZO_SHELL?.trim();
  if (enzoShell && !isSnapOrSimilarShim(enzoShell)) {
    uniqPush(out, process.env.ENZO_SHELL);
  }

  // Standard paths first (/bin/sh) — fast on typical linux; then PATH (Nix, etc.); lastly $SHELL when actually executable here.
  appendStandardPosixFallbacks(out);
  appendPathDiscoveredShells(out);

  const shellEnv = process.env.SHELL?.trim();
  if (
    shellEnv &&
    shellEnv !== process.env.ENZO_SHELL?.trim() &&
    !isSnapOrSimilarShim(shellEnv) &&
    isExecutableFile(path.normalize(shellEnv))
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
  const withoutSnap = posixPathCandidates().filter((p) => !isSnapOrSimilarShim(p));
  return mergePreferredShellsFirst(withoutSnap);
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
