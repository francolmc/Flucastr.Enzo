import { ExecutableTool, ToolExecutionContext, ToolResult } from './types.js';
import type { ReminderService, ReminderChannel } from '../memory/ReminderService.js';
import { notifyTelegramReminderScheduled } from '../memory/reminderHostRegistry.js';

const ALLOW_PAST = process.env.ENZO_ALLOW_PAST_REMINDERS === 'true';

function formatWhen(runAtMs: number, timezone?: string): { iso: string; local: string } {
  const iso = new Date(runAtMs).toISOString();
  const tz = timezone && timezone.trim().length > 0 ? timezone.trim() : 'America/Santiago';
  try {
    const local = new Intl.DateTimeFormat('es-CL', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(runAtMs));
    return { iso, local: `${local} (${tz})` };
  } catch {
    return { iso, local: iso };
  }
}

function tryChileOffsetCorrection(rawRunAt: unknown, timezone: string | undefined): number | null {
  if (typeof rawRunAt !== 'string') return null;
  if (timezone !== 'America/Santiago') return null;
  const s = rawRunAt.trim();
  if (!/[-+]\d{2}:\d{2}$/.test(s)) return null;
  if (s.endsWith('-03:00')) {
    const swapped = s.replace(/-03:00$/, '-04:00');
    const t = Date.parse(swapped);
    return Number.isNaN(t) ? null : t;
  }
  if (s.endsWith('-04:00')) {
    const swapped = s.replace(/-04:00$/, '-03:00');
    const t = Date.parse(swapped);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function getTimeZoneDateParts(date: Date, timeZone: string): { year: number; month: number; day: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = Number(parts.find((p) => p.type === 'year')?.value);
    const month = Number(parts.find((p) => p.type === 'month')?.value);
    const day = Number(parts.find((p) => p.type === 'day')?.value);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    return { year, month, day };
  } catch {
    return null;
  }
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(date);
    const tz = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    const m = tz.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
    if (!m) return null;
    const sign = m[1] === '-' ? -1 : 1;
    const hh = Number(m[2] ?? '0');
    const mm = Number(m[3] ?? '0');
    return sign * (hh * 60 + mm);
  } catch {
    return null;
  }
}

function parseTimeOnly(runAt: string): { hour: number; minute: number } | null {
  const s = runAt.trim().toLowerCase();
  const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (m12) {
    let hour = Number(m12[1]);
    const minute = Number(m12[2]);
    const meridian = m12[3].toLowerCase();
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
    if (meridian === 'am') {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) {
      hour += 12;
    }
    return { hour, minute };
  }
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const hour = Number(m24[1]);
    const minute = Number(m24[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { hour, minute };
  }
  return null;
}

/**
 * Parse runAt: ISO-8601 string, millisecond number, or time-only ("8:58 am", "20:15").
 */
function parseRunAtToMs(
  value: unknown,
  timezone: string,
  nowMs: number
): { ok: true; ms: number } | { ok: false; error: string } {
  if (value === null || value === undefined) {
    return { ok: false, error: 'runAt is required' };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { ok: true, ms: Math.round(value) };
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const raw = value.trim();
    const t = Date.parse(raw);
    if (Number.isNaN(t)) {
      const timeOnly = parseTimeOnly(raw);
      if (!timeOnly) {
        return { ok: false, error: 'runAt could not be parsed as a date/time' };
      }
      const now = new Date(nowMs);
      const d = getTimeZoneDateParts(now, timezone);
      if (!d) return { ok: false, error: `runAt could not resolve date in timezone ${timezone}` };
      const baseUtcLike = Date.UTC(d.year, d.month - 1, d.day, timeOnly.hour, timeOnly.minute, 0, 0);
      const offset = getTimeZoneOffsetMinutes(new Date(baseUtcLike), timezone);
      if (offset === null) return { ok: false, error: `runAt could not resolve timezone offset for ${timezone}` };
      let runAtMs = baseUtcLike - offset * 60_000;
      if (runAtMs < nowMs - 2_000) {
        // Time-only inputs are treated as "next occurrence" if today's time already passed.
        runAtMs += 24 * 60 * 60 * 1000;
      }
      return { ok: true, ms: runAtMs };
    }
    return { ok: true, ms: t };
  }
  return { ok: false, error: 'runAt must be a string (ISO-8601) or number (epoch ms)' };
}

export class ScheduleReminderTool implements ExecutableTool {
  name = 'schedule_reminder';
  readonly actionAliases = ['recordatorio', 'alarma', 'reminder'] as const;
  description =
    'Schedule a one-time reminder. Provide runAt as ISO-8601 (e.g. 2026-04-24T15:00:00-04:00) and text. On Telegram, delivery uses the current chat; on web, no push in MVP (logged / stored only).';
  parameters = {
    type: 'object',
    properties: {
      runAt: {
        type: 'string',
        description: 'When to fire: ISO-8601 datetime with offset, or unambiguous local time (prefer explicit offset or Z)',
      },
      text: { type: 'string', description: 'Short reminder text shown when the notification fires' },
      timezone: {
        type: 'string',
        description: 'Optional IANA timezone (e.g. America/Santiago) for display; stored with the row',
      },
    },
    required: ['runAt', 'text'],
  };

  private readonly reminders: ReminderService;

  constructor(reminders: ReminderService) {
    this.reminders = reminders;
  }

  injectExecutionContext(input: Record<string, unknown>, ctx: ToolExecutionContext): void {
    const uid = ctx.userId;
    if (uid && (!input['userId'] || String(input['userId']).trim() === '')) {
      input['userId'] = uid;
    }
    if (ctx.telegramChatId) {
      input['channel'] = 'telegram' as ReminderChannel;
      input['targetRef'] = String(ctx.telegramChatId);
    } else {
      input['channel'] = 'web' as ReminderChannel;
      input['targetRef'] = ctx.conversationId ?? null;
    }
    if (ctx.source) {
      input['source'] = ctx.source;
    }
    if (ctx.timeZone && (!input['timezone'] || String(input['timezone']).trim() === '')) {
      input['timezone'] = ctx.timeZone;
    }
  }

  async execute(input: {
    runAt: unknown;
    text: unknown;
    userId?: unknown;
    timezone?: unknown;
    channel?: ReminderChannel;
    targetRef?: string | null;
  }): Promise<ToolResult> {
    try {
      const text = typeof input.text === 'string' ? input.text.trim() : '';
      if (!text) {
        return { success: false, error: 'text must be a non-empty string' };
      }

      const tz = typeof input.timezone === 'string' && input.timezone.trim() ? input.timezone.trim() : 'America/Santiago';
      const parsed = parseRunAtToMs(input.runAt, tz, Date.now());
      if (!parsed.ok) {
        return { success: false, error: parsed.error };
      }
      let runAtMs = parsed.ms;

      if (!ALLOW_PAST && runAtMs < Date.now() - 2_000) {
        const corrected = tryChileOffsetCorrection(input.runAt, tz);
        if (corrected !== null && corrected > Date.now() - 2_000) {
          runAtMs = corrected;
        } else {
          return {
            success: false,
            error: 'runAt is in the past; verify timezone/offset (Chile can be -03/-04 depending on date) or specify a future date',
          };
        }
      }

      const channel: ReminderChannel = input.channel === 'telegram' ? 'telegram' : 'web';
      const targetRef =
        input.targetRef === undefined || input.targetRef === null
          ? null
          : String(input.targetRef);

      if (channel === 'telegram' && !targetRef) {
        return {
          success: false,
          error: 'Cannot schedule Telegram reminder: missing chat context (use the Telegram bot for delivery)',
        };
      }

      const uid = typeof input.userId === 'string' ? input.userId.trim() : '';
      if (!uid) {
        return { success: false, error: 'userId is required (host should inject it from the session)' };
      }

      const row = this.reminders.create({
        userId: uid,
        runAtMs,
        message: text,
        timezone: tz,
        channel,
        targetRef: targetRef ?? null,
      });

      notifyTelegramReminderScheduled(row);

      const when = formatWhen(row.runAtMs, row.timezone ?? undefined);
      return {
        success: true,
        data: `Reminder scheduled id=${row.id} at local ${when.local} | utc ${when.iso} (${row.channel})`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
