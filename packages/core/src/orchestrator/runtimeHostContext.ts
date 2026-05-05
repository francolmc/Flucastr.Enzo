import os from 'os';
import type { AmplifierInput } from './types.js';

/**
 * Map loose user labels ("UTC-3", "GMT+2") to fixed IANA zones. Returns undefined if not an explicit offset label.
 * Note: IANA "Etc/GMT±N" naming inverts the sign (Etc/GMT+3 == UTC-3).
 */
export function parseExplicitUtcOffsetLabelToTimeZoneId(raw: string): string | undefined {
  const s = raw.normalize('NFKC').trim().replace(/\s+/g, '').toUpperCase();
  const um = s.replace(/−/g, '-');
  const m =
    um.match(/^UTC([+-])(\d{1,2})$/) ||
    um.match(/^GMT([+-])(\d{1,2})$/) ||
    um.match(/^UTC([+-])(\d{1,2}):(\d{2})$/) ||
    um.match(/^GMT([+-])(\d{1,2}):(\d{2})$/);
  if (!m) {
    return undefined;
  }
  const sign = m[1];
  const hours = Number(m[2]);
  const minutes = m[3] !== undefined ? Number(m[3]) : 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes % 15 !== 0) {
    return undefined;
  }
  if (hours === 0 && minutes === 0) {
    return 'Etc/UTC';
  }
  if (minutes !== 0) {
    return undefined;
  }
  if (sign === '-') {
    return `Etc/GMT+${hours}`;
  }
  return `Etc/GMT-${hours}`;
}

/**
 * Wall clock used in prompts, calendar list windows, and Echo morning brief.
 *
 * - Explicit "UTC±H" / "GMT±H" → fixed `Etc/GMT…` (matches how users describe civil offset).
 * - Falls back to `process.env.TZ` when no value is provided by the caller.
 * - No deployment-specific timezone is hardcoded; the caller (ConfigService / runtimeHints) must supply it.
 */
export function resolvePreferredWallClockTimeZoneId(raw?: string): string {
  const base = (raw ?? '').trim() || process.env.TZ?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const explicit = parseExplicitUtcOffsetLabelToTimeZoneId(base);
  if (explicit) {
    return explicit;
  }
  return base;
}

function localCalendarYyyymmddFromUtcMs(ms: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  let y = 0;
  let m = 0;
  let d = 0;
  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type === 'year') {
      y = Number(part.value);
    } else if (part.type === 'month') {
      m = Number(part.value);
    } else if (part.type === 'day') {
      d = Number(part.value);
    }
  }
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return 0;
  }
  return y * 10000 + m * 100 + d;
}

/** Binary search: earliest UTC ms in a neighborhood of `anchorMs` whose local calendar day is `yyyymmdd` in `timeZone`. */
function utcFirstInstantOfLocalYyyymmdd(anchorMs: number, timeZone: string, targetYyyymmdd: number): number {
  let lo = anchorMs - 96 * 3600 * 1000;
  let hi = anchorMs + 96 * 3600 * 1000;
  let guard = 0;
  while (guard++ < 32 && localCalendarYyyymmddFromUtcMs(lo, timeZone) >= targetYyyymmdd) lo -= 24 * 3600 * 1000;
  guard = 0;
  while (guard++ < 32 && localCalendarYyyymmddFromUtcMs(hi, timeZone) < targetYyyymmdd) hi += 24 * 3600 * 1000;
  guard = 0;
  while (guard++ < 64 && hi - lo > 120_000) {
    const mid = Math.floor((lo + hi) / 2);
    if (localCalendarYyyymmddFromUtcMs(mid, timeZone) < targetYyyymmdd) lo = mid;
    else hi = mid;
  }
  return hi;
}

function utcInclusiveEndMsOfSameLocalCalendarDay(dayStartUtcMs: number, timeZone: string): number {
  const dayKey = localCalendarYyyymmddFromUtcMs(dayStartUtcMs, timeZone);
  let lo = dayStartUtcMs;
  let hi = dayStartUtcMs + 96 * 3600 * 1000;
  let guard = 0;
  while (guard++ < 32 && localCalendarYyyymmddFromUtcMs(hi, timeZone) <= dayKey) hi += 12 * 3600 * 1000;
  while (hi - lo > 120_000) {
    const mid = Math.floor((lo + hi) / 2);
    if (localCalendarYyyymmddFromUtcMs(mid, timeZone) <= dayKey) lo = mid;
    else hi = mid;
  }
  return hi - 1;
}

/**
 * Inclusive `[from_iso, to_iso]` UTC range covering the current day in the caller-supplied timezone.
 *
 * The temporal intent (today / tomorrow / this week) is determined by the LLM via the classifier;
 * this function always returns the current day's range as an anchor for calendar tool calls.
 *
 * Exported for tests — do not widen without updating calendar list locked prompt callers.
 */
export function computeInclusiveUtcIsoRangeForPersistedCalendarListLexicalPrompt(
  _message: string,
  hints?: AmplifierInput['runtimeHints']
): { from_iso: string; to_iso: string } {
  const tz = resolvePreferredWallClockTimeZoneId(hints?.timeZone);
  const anchorNow = Date.now();
  const ks = localCalendarYyyymmddFromUtcMs(anchorNow, tz);
  const fromMs = utcFirstInstantOfLocalYyyymmdd(anchorNow, tz, ks);
  const toMs = utcInclusiveEndMsOfSameLocalCalendarDay(fromMs, tz);
  return { from_iso: new Date(fromMs).toISOString(), to_iso: new Date(toMs).toISOString() };
}

/**
 * Compact wall-clock hint for prompts (timezone from profile/runtimeHints preferred over server-local).
 */
export function describeLocalWallClockPromptLine(
  hints?: AmplifierInput['runtimeHints']
): string {
  const tz = resolvePreferredWallClockTimeZoneId(hints?.timeZone);
  const locale = hints?.timeLocale ?? Intl.DateTimeFormat().resolvedOptions().locale;
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

/**
 * Default runtime hints for the process Enzo is running in (merge with per-request overrides).
 *
 * `timeZone` and `timeLocale` MUST be supplied by the caller via `overrides` (read from ConfigService).
 * No deployment-specific defaults are applied here — the system timezone and locale are inferred from
 * the runtime environment only as a last resort.
 */
export function buildOrchestratorRuntimeHints(
  overrides?: Partial<NonNullable<AmplifierInput['runtimeHints']>>
): NonNullable<AmplifierInput['runtimeHints']> {
  const platform = process.platform;
  const systemTz = process.env.TZ?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale;
  const merged: NonNullable<AmplifierInput['runtimeHints']> = {
    homeDir: process.env.HOME ?? os.homedir(),
    osLabel: humanOsLabel(platform),
    timeLocale: systemLocale,
    timeZone: systemTz,
    hostPlatform: platform,
    posixShell: platform !== 'win32',
    kernelRelease: platform !== 'win32' ? os.release() : undefined,
    arch: os.arch(),
    ...overrides,
  };
  merged.timeZone = resolvePreferredWallClockTimeZoneId(merged.timeZone);
  return merged;
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
