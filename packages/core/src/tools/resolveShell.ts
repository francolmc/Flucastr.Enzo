import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';

/**
 * Locate bash/sh via PATH without spawning a POSIX shell (avoids relying on `/bin/sh`).
 */
function shellFromPathEnv(): string | undefined {
  const exe =
    os.platform() === 'win32' ? ['bash.exe', 'sh.exe'] : ['bash', 'sh'];
  const dirs = process.env.PATH?.split(path.delimiter).filter(Boolean) ?? [];
  for (const dir of dirs) {
    for (const name of exe) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

export type ResolvedShell = { shell: string; args: string[] };

export function resolveShell(): ResolvedShell {
  const platform = os.platform();

  if (platform === 'win32') {
    const pwsh = process.env.COMSPEC ?? 'cmd.exe';
    return { shell: pwsh, args: ['/c'] };
  }

  const candidates = [
    process.env.SHELL?.trim(),
    '/usr/bin/bash',
    '/bin/bash',
    '/usr/bin/sh',
    '/bin/sh',
    '/usr/local/bin/bash',
    '/opt/homebrew/bin/bash',
  ].filter((c): c is string => !!c && c.length > 0);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { shell: candidate, args: ['-c'] };
    }
  }

  const fromPath = shellFromPathEnv();
  if (fromPath) {
    return { shell: fromPath, args: ['-c'] };
  }

  try {
    const found = execSync('which bash || which sh', { encoding: 'utf8' }).trim();
    if (found) return { shell: found, args: ['-c'] };
  } catch {
    /* fall through */
  }

  throw new Error('No shell found. Install bash or sh and ensure it is in PATH.');
}
