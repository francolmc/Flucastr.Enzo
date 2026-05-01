import type { CalendarEventRow } from '../calendar/types.js';
import { ExecutableTool, ToolResult } from './types.js';
import type { CalendarService } from '../calendar/CalendarService.js';

const SERVER_USER_KEY = '__enzoScopedUserId';

function parseIsoToMs(raw: unknown, label: string): { ms: number } | { error: string } {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) {
    return { error: `${label} is required and must be a non-empty ISO 8601 string` };
  }
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) {
    return { error: `${label} must be valid ISO 8601 (received: "${s}")` };
  }
  return { ms };
}

function linesForEvents(rows: CalendarEventRow[]): string {
  if (rows.length === 0) {
    return 'No hay eventos en el rango solicitado.';
  }
  return rows
    .map((e) => {
      const tail = e.endAt ? `–${new Date(e.endAt).toISOString()}` : '';
      const note = e.notes ? ` | ${e.notes}` : '';
      return `- [${e.id}] ${e.title} @ ${new Date(e.startAt).toISOString()}${tail}${note}`;
    })
    .join('\n');
}

export class CalendarTool implements ExecutableTool {
  name = 'calendar';
  description =
    'Create, list, update, or delete scheduled calendar/agenda entries for this user (UTC stored; pass ISO8601 timestamps). Use for meetings, reminders, deadlines, and time ranges.';
  parameters = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        description: 'add | list | update | delete',
        enum: ['add', 'list', 'update', 'delete'],
      },
      title: { type: 'string', description: 'Event title (required for add)' },
      notes: { type: 'string', description: 'Optional notes' },
      start_iso: { type: 'string', description: 'ISO 8601 start instant (required for add; optional on update)' },
      end_iso: { type: 'string', description: 'Optional ISO 8601 end instant' },
      from_iso: { type: 'string', description: 'ISO 8601 window start inclusive (list)' },
      to_iso: { type: 'string', description: 'ISO 8601 window end inclusive (list)' },
      event_id: { type: 'string', description: 'Event id UUID (update/delete)' },
    },
    required: ['action'],
  };

  constructor(private readonly calendar: CalendarService) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const userIdRaw = input[SERVER_USER_KEY];
    const userId = typeof userIdRaw === 'string' ? userIdRaw.trim() : '';
    if (!userId) {
      return {
        success: false,
        output: '',
        error:
          'Internal: missing scoped user id for calendar. This should never happen — the host attaches it automatically.',
      };
    }

    const action = String(input.action ?? '').trim().toLowerCase();
    try {
      if (action === 'add') {
        const title = String(input.title ?? '').trim();
        if (!title) {
          return { success: false, output: '', error: 'add requires title' };
        }
        const start = parseIsoToMs(input.start_iso, 'start_iso');
        if ('error' in start) {
          return { success: false, output: '', error: start.error };
        }
        let endMs: number | null = null;
        if (input.end_iso !== undefined && input.end_iso !== null && String(input.end_iso).trim() !== '') {
          const end = parseIsoToMs(input.end_iso, 'end_iso');
          if ('error' in end) {
            return { success: false, output: '', error: end.error };
          }
          endMs = end.ms;
          if (endMs < start.ms) {
            return { success: false, output: '', error: 'end_iso must be >= start_iso' };
          }
        }
        const notesRaw = input.notes;
        const notes =
          notesRaw === undefined || notesRaw === null ? null : String(notesRaw).trim() || null;
        const created = await this.calendar.insert(userId, {
          title,
          startAt: start.ms,
          endAt: endMs,
          notes,
        });
        return {
          success: true,
          output: `Created event ${created.id}: "${created.title}" at ${new Date(created.startAt).toISOString()}`,
        };
      }

      if (action === 'list') {
        const from = parseIsoToMs(input.from_iso, 'from_iso');
        if ('error' in from) {
          return { success: false, output: '', error: from.error };
        }
        const to = parseIsoToMs(input.to_iso, 'to_iso');
        if ('error' in to) {
          return { success: false, output: '', error: to.error };
        }
        if (to.ms < from.ms) {
          return { success: false, output: '', error: 'to_iso must be >= from_iso' };
        }
        const rows = await this.calendar.listInRange(userId, from.ms, to.ms);
        return { success: true, output: linesForEvents(rows) };
      }

      if (action === 'update') {
        const id = String(input.event_id ?? '').trim();
        if (!id) {
          return { success: false, output: '', error: 'update requires event_id' };
        }
        const patch: {
          title?: string;
          startAt?: number;
          endAt?: number | null;
          notes?: string | null;
        } = {};
        if (input.title !== undefined) {
          const t = String(input.title ?? '').trim();
          if (!t) {
            return { success: false, output: '', error: 'title must be non-empty if provided' };
          }
          patch.title = t;
        }
        if (input.start_iso !== undefined && String(input.start_iso ?? '').trim() !== '') {
          const start = parseIsoToMs(input.start_iso, 'start_iso');
          if ('error' in start) {
            return { success: false, output: '', error: start.error };
          }
          patch.startAt = start.ms;
        }
        if (input.end_iso !== undefined) {
          if (input.end_iso === null || String(input.end_iso).trim() === '') {
            patch.endAt = null;
          } else {
            const end = parseIsoToMs(input.end_iso, 'end_iso');
            if ('error' in end) {
              return { success: false, output: '', error: end.error };
            }
            patch.endAt = end.ms;
          }
        }
        if (input.notes !== undefined) {
          patch.notes =
            input.notes === null ? null : String(input.notes ?? '').trim() || null;
        }

        if (Object.keys(patch).length === 0) {
          return {
            success: false,
            output: '',
            error: 'update requires at least one of: title, start_iso, end_iso, notes',
          };
        }

        const current = await this.calendar.getById(userId, id);
        if (!current) {
          return { success: false, output: '', error: `Unknown event id: ${id}` };
        }

        const nextStart = patch.startAt ?? current.startAt;
        const nextEnd =
          patch.endAt !== undefined
            ? patch.endAt === null
              ? null
              : patch.endAt
            : current.endAt;

        if (nextEnd !== null && nextEnd < nextStart) {
          return { success: false, output: '', error: 'end must be >= start after update' };
        }

        const updated = await this.calendar.update(userId, id, patch);
        if (!updated) {
          return { success: false, output: '', error: `Could not update event ${id}` };
        }
        return {
          success: true,
          output: `Updated ${updated.id}: "${updated.title}" @ ${new Date(updated.startAt).toISOString()}`,
        };
      }

      if (action === 'delete') {
        const id = String(input.event_id ?? '').trim();
        if (!id) {
          return { success: false, output: '', error: 'delete requires event_id' };
        }
        const ok = await this.calendar.delete(userId, id);
        if (!ok) {
          return { success: false, output: '', error: `Unknown event id: ${id}` };
        }
        return { success: true, output: `Deleted calendar event ${id}` };
      }

      return { success: false, output: '', error: `Unknown action: ${action}` };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
