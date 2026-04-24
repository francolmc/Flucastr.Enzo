import { ExecutableTool, ToolExecutionContext, ToolResult } from './types.js';
import type { ReminderService, ReminderChannel } from '../memory/ReminderService.js';

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

/**
 * Parse runAt: ISO-8601 string or millisecond number.
 */
function parseRunAtToMs(value: unknown): { ok: true; ms: number } | { ok: false; error: string } {
  if (value === null || value === undefined) {
    return { ok: false, error: 'runAt is required' };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { ok: true, ms: Math.round(value) };
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const t = Date.parse(value);
    if (Number.isNaN(t)) {
      return { ok: false, error: 'runAt could not be parsed as a date' };
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

      const parsed = parseRunAtToMs(input.runAt);
      if (!parsed.ok) {
        return { success: false, error: parsed.error };
      }
      const runAtMs = parsed.ms;

      if (!ALLOW_PAST && runAtMs < Date.now() - 2_000) {
        return {
          success: false,
          error: 'runAt is in the past; use a future time (or set ENZO_ALLOW_PAST_REMINDERS=true for tests)',
        };
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

      const tz = typeof input.timezone === 'string' && input.timezone.trim() ? input.timezone.trim() : undefined;

      const row = this.reminders.create({
        userId: uid,
        runAtMs,
        message: text,
        timezone: tz,
        channel,
        targetRef: targetRef ?? null,
      });

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
