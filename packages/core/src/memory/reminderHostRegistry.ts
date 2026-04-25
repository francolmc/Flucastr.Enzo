import type { ScheduledReminder } from './ReminderService.js';

/**
 * Hosts (e.g. @enzo/telegram) register a callback that runs exactly after a telegram
 * reminder row is inserted, so one-shot timers are armed even if {@link ReminderService}
 * is not the same object instance as the one held by {@link ScheduleReminderTool}
 * (both still share the same SQLite file via {@link DatabaseManager}).
 */
let telegramAfterCreate: ((row: ScheduledReminder) => void) | null = null;

export function setTelegramReminderScheduledHandler(handler: ((row: ScheduledReminder) => void) | null): void {
  telegramAfterCreate = handler;
}

/** Called from {@link ScheduleReminderTool} after a successful insert. */
export function notifyTelegramReminderScheduled(row: ScheduledReminder): void {
  if (row.channel !== 'telegram') return;
  if (!telegramAfterCreate) return;
  try {
    telegramAfterCreate(row);
  } catch (e) {
    console.error('[Reminders] telegramAfterCreate handler error:', e);
  }
}
