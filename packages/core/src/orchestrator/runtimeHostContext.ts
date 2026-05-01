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

const CHILE_MAINLAND_IANA = new Set(['america/santiago', 'chile/continental']);

/**
 * Wall clock used in prompts, calendar list windows, and Echo morning brief.
 *
 * - Explicit "UTC±H" / "GMT±H" → fixed `Etc/GMT…` (matches how users describe civil offset).
 * - `America/Santiago` (and `Chile/Continental`): Node's tzdb often uses seasonal CLT/CST; Chile's
 *   common civil expectation is **UTC-3** (`Etc/GMT+3`) for mainland. Set `ENZO_KEEP_IANA_SANTIAGO=true`
 *   to keep canonical IANA offsets instead.
 */
export function resolvePreferredWallClockTimeZoneId(raw?: string): string {
  const keepIanaSantiago =
    process.env.ENZO_KEEP_IANA_SANTIAGO === 'true' || process.env.ENZO_KEEP_IANA_SANTIAGO === '1';
  const base = (raw ?? '').trim() || process.env.TZ?.trim() || 'America/Santiago';
  const explicit = parseExplicitUtcOffsetLabelToTimeZoneId(base);
  if (explicit) {
    return explicit;
  }
  if (!keepIanaSantiago && CHILE_MAINLAND_IANA.has(base.toLowerCase())) {
    return 'Etc/GMT+3';
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
 * Inclusive `[from_iso, to_iso]` UTC range covering the persisted calendar user's asked window
 * (`hoy`, `mañana`, `esta semana`) resolved in their profile timezone defaults.
 *
 * Exported for tests — do not widen without updating calendar list locked prompt callers.
 */
export function computeInclusiveUtcIsoRangeForPersistedCalendarListLexicalPrompt(
  message: string,
  hints?: AmplifierInput['runtimeHints']
): { from_iso: string; to_iso: string } {
  const tz = resolvePreferredWallClockTimeZoneId(hints?.timeZone ?? 'America/Santiago');
  const normalized = message.toLowerCase();
  const anchorNow = Date.now();

  const hasWeek = /\besta\s+semana\b/u.test(normalized) || /\bthis\s+week\b/u.test(normalized);

  let includeToday =
    /\b(hoy|today|este\s+d[ií]a|el\s+d[ií]a\s+de\s+hoy|d[ií]a\s+de\s+hoy)\b/u.test(normalized);
  let includeTomorrow =
    /\b(mañana|tomorrow)\b/u.test(normalized) &&
    !/\bpasado\s+mañana\b/u.test(normalized) &&
    !/\bday\s+after\s+tomorrow\b/u.test(normalized);

  if (!includeToday && !includeTomorrow && !hasWeek) {
    includeToday = true;
  }

  if (hasWeek) {
    const todayStart = utcFirstInstantOfLocalYyyymmdd(
      anchorNow,
      tz,
      localCalendarYyyymmddFromUtcMs(anchorNow, tz)
    );
    let fromMs = todayStart;
    let toMs = utcInclusiveEndMsOfSameLocalCalendarDay(todayStart, tz);
    for (let d = 1; d <= 6; d += 1) {
      const probe = todayStart + d * 26 * 3600 * 1000;
      const dayStart = utcFirstInstantOfLocalYyyymmdd(probe, tz, localCalendarYyyymmddFromUtcMs(probe, tz));
      const dayEnd = utcInclusiveEndMsOfSameLocalCalendarDay(dayStart, tz);
      fromMs = Math.min(fromMs, dayStart);
      toMs = Math.max(toMs, dayEnd);
    }
    return { from_iso: new Date(fromMs).toISOString(), to_iso: new Date(toMs).toISOString() };
  }

  const spans: Array<{ lo: number; hi: number }> = [];

  if (includeToday) {
    const ks = localCalendarYyyymmddFromUtcMs(anchorNow, tz);
    const s = utcFirstInstantOfLocalYyyymmdd(anchorNow, tz, ks);
    spans.push({ lo: s, hi: utcInclusiveEndMsOfSameLocalCalendarDay(s, tz) });
  }
  if (includeTomorrow) {
    const tomorrowProbe = utcFirstInstantOfLocalYyyymmdd(
      anchorNow + 28 * 3600 * 1000,
      tz,
      localCalendarYyyymmddFromUtcMs(anchorNow + 28 * 3600 * 1000, tz)
    );
    const kt = localCalendarYyyymmddFromUtcMs(tomorrowProbe, tz);
    const s = utcFirstInstantOfLocalYyyymmdd(tomorrowProbe, tz, kt);
    spans.push({ lo: s, hi: utcInclusiveEndMsOfSameLocalCalendarDay(s, tz) });
  }

  let fromMs = spans[0]!.lo;
  let toMs = spans[0]!.hi;
  for (const r of spans) {
    fromMs = Math.min(fromMs, r.lo);
    toMs = Math.max(toMs, r.hi);
  }
  return { from_iso: new Date(fromMs).toISOString(), to_iso: new Date(toMs).toISOString() };
}

/**
 * Compact wall-clock hint for prompts (timezone from profile/runtimeHints preferred over server-local).
 */
export function describeLocalWallClockPromptLine(
  hints?: AmplifierInput['runtimeHints']
): string {
  const tz = resolvePreferredWallClockTimeZoneId(hints?.timeZone ?? 'America/Santiago');
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
  const merged: NonNullable<AmplifierInput['runtimeHints']> = {
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
