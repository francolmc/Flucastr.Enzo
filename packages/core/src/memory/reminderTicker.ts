import type { ReminderChannel, ReminderService } from './ReminderService.js';

export type ReminderTickerOptions = {
  intervalMs?: number;
  /** Deliver Telegram reminders. If omitted, ticker should usually run only for `web` channel rows. */
  sendTelegram?: (chatId: string, text: string) => Promise<void>;
  /** Channels this worker is allowed to consume. Defaults: ['telegram'] if sendTelegram exists, else ['web']. */
  channels?: ReminderChannel[];
};

/**
 * Periodically processes due rows.
 * For each due reminder: sends via `sendTelegram` when channel is telegram; logs web channel.
 */
export function startReminderTicker(
  reminderService: ReminderService,
  options: ReminderTickerOptions = {}
): NodeJS.Timeout {
  const intervalMs = options.intervalMs ?? 45_000;
  const channels: ReminderChannel[] =
    options.channels && options.channels.length > 0
      ? options.channels
      : options.sendTelegram
        ? ['telegram']
        : ['web'];
  return setInterval(() => {
    void (async () => {
      try {
        for (;;) {
          const row = reminderService.claimNextDue(Date.now(), channels);
          if (!row) break;
          if (row.channel === 'telegram' && row.targetRef) {
            if (options.sendTelegram) {
              try {
                await options.sendTelegram(
                  row.targetRef,
                  `Recordatorio: ${row.message}\n_id:${row.id}_`
                );
                reminderService.markSent(row.id);
              } catch (e) {
                console.error('[Reminders] Telegram send failed:', e);
                reminderService.requeue(row.id);
              }
            } else {
              console.warn(
                `[Reminders] Telegram reminder ${row.id} has no sendTelegram handler (message: ${row.message})`
              );
              reminderService.requeue(row.id);
            }
          } else {
            console.log(`[Reminders] Web / no target — user ${row.userId}: ${row.message} (id ${row.id})`);
            reminderService.markSent(row.id);
          }
        }
      } catch (e) {
        console.error('[Reminders] tick error:', e);
      }
    })();
  }, intervalMs);
}
