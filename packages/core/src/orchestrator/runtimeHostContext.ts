import os from 'os';
import type { AmplifierInput } from './types.js';

/**
 * Compact wall-clock hint for prompts (timezone from profile/runtimeHints preferred over server-local).
 */
export function describeLocalWallClockPromptLine(
  hints?: AmplifierInput['runtimeHints']
): string {
  const tz = hints?.timeZone ?? 'America/Santiago';
  const locale = hints?.timeLocale ?? 'es-CL';
  const now = new Date();
  try {
    const formatted = new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now);
    return `User local time (${tz}, ${locale}): ${formatted}. UTC: ${now.toISOString()}.`;
  } catch {
    return `Server UTC: ${now.toISOString()} (timezone hint "${tz}", locale "${locale}" could not format).`;
  }
}

/** Human-readable OS name for prompts (not for branching logic in tools). */
export function humanOsLabel(platform: NodeJS.Platform = process.platform): string {
  switch (platform) {
    case 'darwin':
      return 'macOS';
    case 'win32':
      return 'Windows';
    case 'linux':
      return 'Linux';
    case 'freebsd':
      return 'FreeBSD';
    case 'openbsd':
      return 'OpenBSD';
    case 'sunos':
      return 'Solaris';
    case 'aix':
      return 'AIX';
    default:
      return platform;
  }
}

/** Default runtime hints for the process Enzo is running in (merge with per-request overrides). */
export function buildOrchestratorRuntimeHints(
  overrides?: Partial<NonNullable<AmplifierInput['runtimeHints']>>
): NonNullable<AmplifierInput['runtimeHints']> {
  const platform = process.platform;
  return {
    homeDir: process.env.HOME ?? os.homedir(),
    osLabel: humanOsLabel(platform),
    timeLocale: 'es-CL',
    timeZone: 'America/Santiago',
    hostPlatform: platform,
    posixShell: platform !== 'win32',
    kernelRelease: platform !== 'win32' ? os.release() : undefined,
    arch: os.arch(),
    ...overrides,
  };
}

/**
 * Short block for THINK / fast-path: model must pick commands for THIS host,
 * not memorized examples from another OS — without hardcoding product if/else trees in code.
 */
export function describeHostForExecuteCommandPrompt(hints?: AmplifierInput['runtimeHints']): string {
  const bits = [
    hints?.osLabel ?? humanOsLabel(),
    hints?.hostPlatform != null ? String(hints.hostPlatform) : process.platform,
    hints?.arch ?? os.arch(),
    hints?.kernelRelease ? `kernel ${hints.kernelRelease}` : null,
    hints?.posixShell === false ? 'non-POSIX shell' : 'POSIX-capable shell',
  ].filter(Boolean);
  return (
    `EXECUTE_COMMAND runs only on this server: ${bits.join(' · ')}. ` +
    `Infer paths, utilities, and flags from that environment (GNU Linux, macOS BSD userland, Windows, etc. differ). ` +
    `Do not reuse command lines that only apply to a different OS than the labels above.`
  );
}
