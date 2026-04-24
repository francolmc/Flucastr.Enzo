import type { ReminderChannel, ReminderService } from './ReminderService.js';

export type ReminderTickerOptions = {
  intervalMs?: number;
  /** Deliver Telegram reminders. If omitted, ticker should usually run only for `web` channel rows. */
  sendTelegram?: (chatId: string, text: string) => Promise<void>;
  /** Channels this worker is allowed to consume. Defaults: ['telegram'] if sendTelegram exists, else ['web']. */
  channels?: ReminderChannel[];
  onTickSummary?: (summary: {
    channels: ReminderChannel[];
    claimed: number;
    sent: number;
    requeued: number;
    webMarkedSent: number;
    elapsedMs: number;
  }) => void;
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
      const tickStart = Date.now();
      let claimed = 0;
      let sent = 0;
      let requeued = 0;
      let webMarkedSent = 0;
      try {
        for (;;) {
          const row = reminderService.claimNextDue(Date.now(), channels);
          if (!row) break;
          claimed += 1;
          if (row.channel === 'telegram' && row.targetRef) {
            if (options.sendTelegram) {
              try {
                await options.sendTelegram(
                  row.targetRef,
                  `Recordatorio: ${row.message}\n_id:${row.id}_`
                );
                reminderService.markSent(row.id);
                sent += 1;
                console.log(`[Reminders] sent telegram id=${row.id} chat=${row.targetRef}`);
              } catch (e) {
                console.error(`[Reminders] Telegram send failed id=${row.id}:`, e);
                reminderService.requeue(row.id);
                requeued += 1;
              }
            } else {
              console.warn(
                `[Reminders] Telegram reminder ${row.id} has no sendTelegram handler (message: ${row.message})`
              );
              reminderService.requeue(row.id);
              requeued += 1;
            }
          } else {
            console.log(`[Reminders] web reminder marked sent id=${row.id} user=${row.userId}`);
            reminderService.markSent(row.id);
            webMarkedSent += 1;
          }
        }
        const summary = {
          channels,
          claimed,
          sent,
          requeued,
          webMarkedSent,
          elapsedMs: Date.now() - tickStart,
        };
        if (claimed > 0) {
          console.log(
            `[Reminders] tick summary channels=${channels.join(',')} claimed=${claimed} sent=${sent} requeued=${requeued} webSent=${webMarkedSent} elapsedMs=${summary.elapsedMs}`
          );
        }
        options.onTickSummary?.(summary);
      } catch (e) {
        console.error('[Reminders] tick error:', e);
      }
    })();
  }, intervalMs);
}
