import type { ReminderChannel, ReminderService } from './ReminderService.js';

export type ReminderTickerOptions = {
  intervalMs?: number;
  /** Deliver Telegram reminders. If omitted, ticker should usually run only for `web` channel rows. */
  sendTelegram?: (chatId: string, text: string) => Promise<void>;
  /** Fails the send and requeues if Telegraf/HTTP does not complete in this time. */
  sendTimeoutMs?: number;
  /**
   * Rows left in `processing` longer than this after `runAt` are reset to `pending` at the start of each tick.
   * Default 120_000 (2 min). Set to 0 to disable.
   */
  staleProcessingRecoveryMs?: number;
  /** Channels this worker is allowed to consume. Defaults: ['telegram'] if sendTelegram exists, else ['web']. */
  channels?: ReminderChannel[];
  onTickSummary?: (summary: {
    channels: ReminderChannel[];
    claimed: number;
    sent: number;
    requeued: number;
    webMarkedSent: number;
    staleRecovered: number;
    elapsedMs: number;
  }) => void;
};

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  if (ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        }
      );
  });
}

/**
 * Periodically processes due rows.
 * For each due reminder: sends via `sendTelegram` when channel is telegram; logs web channel.
 * Runs an immediate tick on start (unlike a plain setInterval) so the first check is not delayed by one full interval.
 */
export function startReminderTicker(
  reminderService: ReminderService,
  options: ReminderTickerOptions = {}
): NodeJS.Timeout {
  const intervalMs = options.intervalMs ?? 45_000;
  const staleMs = options.staleProcessingRecoveryMs ?? 120_000;
  const sendTimeoutMs = options.sendTimeoutMs ?? 60_000;
  const channels: ReminderChannel[] =
    options.channels && options.channels.length > 0
      ? options.channels
      : options.sendTelegram
        ? ['telegram']
        : ['web'];

  const runTick = () => {
    void (async () => {
      const tickStart = Date.now();
      let claimed = 0;
      let sent = 0;
      let requeued = 0;
      let webMarkedSent = 0;
      let staleRecovered = 0;
      try {
        if (staleMs > 0) {
          staleRecovered = reminderService.requeueStaleProcessing(staleMs, Date.now());
          if (staleRecovered > 0) {
            console.warn(
              `[Reminders] requeued ${staleRecovered} stale processing row(s) (>${staleMs}ms past runAt)`
            );
          }
        }
        for (;;) {
          const row = reminderService.claimNextDue(Date.now(), channels);
          if (!row) break;
          claimed += 1;
          if (row.channel === 'telegram' && row.targetRef) {
            if (options.sendTelegram) {
              try {
                await withTimeout(
                  options.sendTelegram(
                    row.targetRef,
                    `Recordatorio: ${row.message}\n_id:${row.id}_`
                  ),
                  sendTimeoutMs,
                  `Telegram send timed out after ${sendTimeoutMs}ms`
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
          staleRecovered,
          elapsedMs: Date.now() - tickStart,
        };
        if (claimed > 0 || staleRecovered > 0) {
          console.log(
            `[Reminders] tick summary channels=${channels.join(',')} staleRecovered=${staleRecovered} claimed=${claimed} sent=${sent} requeued=${requeued} webSent=${webMarkedSent} elapsedMs=${summary.elapsedMs}`
          );
        }
        options.onTickSummary?.(summary);
      } catch (e) {
        console.error('[Reminders] tick error:', e);
      }
    })();
  };

  runTick();
  return setInterval(runTick, intervalMs);
}
