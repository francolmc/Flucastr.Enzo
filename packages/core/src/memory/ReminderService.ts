import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from './Database.js';

export type ReminderStatus = 'pending' | 'sent' | 'cancelled';
export type ReminderChannel = 'telegram' | 'web';

export interface ScheduledReminder {
  id: string;
  userId: string;
  runAtMs: number;
  message: string;
  timezone: string | null;
  channel: ReminderChannel;
  targetRef: string | null;
  status: ReminderStatus;
  createdAtMs: number;
  sentAtMs: number | null;
}

/**
 * CRUD and atomic claim for scheduled reminders in the same SQLite file as {@link MemoryService}.
 */
export class ReminderService {
  private readonly db: DatabaseManager;

  constructor(dbPath?: string) {
    this.db = DatabaseManager.getInstance(dbPath);
  }

  private run(sql: string, params: any[] = []): void {
    this.db.getDb().run(sql, params);
  }

  private get<T = any>(sql: string, params: any[] = []): T | undefined {
    return this.db.getDb().get(sql, params) as T | undefined;
  }

  create(input: {
    userId: string;
    runAtMs: number;
    message: string;
    timezone?: string;
    channel: ReminderChannel;
    targetRef: string | null;
  }): ScheduledReminder {
    const id = uuidv4();
    const now = Date.now();
    this.run(
      `INSERT INTO scheduled_reminders
       (id, userId, runAtMs, message, timezone, channel, targetRef, status, createdAtMs, sentAtMs)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`,
      [
        id,
        input.userId,
        input.runAtMs,
        input.message,
        input.timezone ?? null,
        input.channel,
        input.targetRef,
        now,
      ]
    );
    return {
      id,
      userId: input.userId,
      runAtMs: input.runAtMs,
      message: input.message,
      timezone: input.timezone ?? null,
      channel: input.channel,
      targetRef: input.targetRef,
      status: 'pending',
      createdAtMs: now,
      sentAtMs: null,
    };
  }

  /**
   * Atomically take the next due pending reminder for the given channels and mark it as sent.
   * This is process-safe across multiple workers reading from the same SQLite file.
   */
  claimAndMarkNextDue(nowMs: number, channels?: ReminderChannel[]): ScheduledReminder | null {
    const dbw = this.db.getDb();
    try {
      dbw.run('BEGIN IMMEDIATE', []);
      const channelFilter = channels && channels.length > 0 ? channels : null;
      const channelSql =
        channelFilter && channelFilter.length > 0
          ? ` AND channel IN (${channelFilter.map(() => '?').join(', ')})`
          : '';
      const selectParams = channelFilter ? [nowMs, ...channelFilter] : [nowMs];
      const row = dbw.get(
        `SELECT * FROM scheduled_reminders
         WHERE status = 'pending' AND runAtMs <= ?${channelSql}
         ORDER BY runAtMs ASC
         LIMIT 1`,
        selectParams
      ) as Record<string, unknown> | undefined;

      if (!row) {
        dbw.run('COMMIT', []);
        return null;
      }

      const id = String(row.id);
      const sentAt = Date.now();
      dbw.run(
        `UPDATE scheduled_reminders SET status = 'sent', sentAtMs = ? WHERE id = ? AND status = 'pending'`,
        [sentAt, id]
      );
      const ch = dbw.get('SELECT changes() as ch', []) as { ch: number } | undefined;
      dbw.run('COMMIT', []);
      if (!ch || ch.ch !== 1) {
        return null;
      }

      return {
        id,
        userId: String(row.userId),
        runAtMs: Number(row.runAtMs),
        message: String(row.message),
        timezone: row.timezone != null ? String(row.timezone) : null,
        channel: (row.channel === 'telegram' ? 'telegram' : 'web') as ReminderChannel,
        targetRef: row.targetRef != null ? String(row.targetRef) : null,
        status: 'sent',
        createdAtMs: Number(row.createdAtMs),
        sentAtMs: sentAt,
      };
    } catch (e) {
      try {
        dbw.run('ROLLBACK', []);
      } catch {
        // ignore
      }
      throw e;
    }
  }
}
