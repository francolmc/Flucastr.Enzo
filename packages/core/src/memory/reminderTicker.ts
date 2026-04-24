import type { ReminderService } from './ReminderService.js';

export type ReminderTickerOptions = {
  intervalMs?: number;
  /** Deliver Telegram reminders. If omitted, telegram rows are still marked sent and logged as skipped. */
  sendTelegram?: (chatId: string, text: string) => Promise<void>;
};

/**
 * Periodically processes due rows (already marked sent in claim — see ReminderService).
 * For each due reminder: sends via `sendTelegram` when channel is telegram; logs web channel.
 */
export function startReminderTicker(
  reminderService: ReminderService,
  options: ReminderTickerOptions = {}
): NodeJS.Timeout {
  const intervalMs = options.intervalMs ?? 45_000;
  return setInterval(() => {
    void (async () => {
      try {
        for (;;) {
          const row = reminderService.claimAndMarkNextDue(Date.now());
          if (!row) break;
          if (row.channel === 'telegram' && row.targetRef) {
            if (options.sendTelegram) {
              try {
                await options.sendTelegram(
                  row.targetRef,
                  `Recordatorio: ${row.message}\n_id:${row.id}_`
                );
              } catch (e) {
                console.error('[Reminders] Telegram send failed:', e);
              }
            } else {
              console.warn(
                `[Reminders] Telegram reminder ${row.id} has no sendTelegram handler (message: ${row.message})`
              );
            }
          } else {
            console.log(`[Reminders] Web / no target — user ${row.userId}: ${row.message} (id ${row.id})`);
          }
        }
      } catch (e) {
        console.error('[Reminders] tick error:', e);
      }
    })();
  }, intervalMs);
}
