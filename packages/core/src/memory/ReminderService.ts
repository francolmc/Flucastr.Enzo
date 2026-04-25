import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from './Database.js';

export type ReminderStatus = 'pending' | 'processing' | 'sent' | 'cancelled';
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

export interface ReminderStatusCount {
  status: ReminderStatus;
  count: number;
}

/**
 * Optional hook: hosts (e.g. Telegram) can schedule one-shot `setTimeout` delivery when a row is created.
 * Must be cheap; avoid throwing.
 */
export type ReminderCreatedListener = (row: ScheduledReminder) => void;

/**
 * CRUD and atomic claim for scheduled reminders in the same SQLite file as {@link MemoryService}.
 */
export class ReminderService {
  private readonly db: DatabaseManager;
  private onReminderCreated: ReminderCreatedListener | null = null;

  constructor(dbPath?: string) {
    this.db = DatabaseManager.getInstance(dbPath);
  }

  /** Fires in-process after a row is written (e.g. to arm a one-shot `setTimeout` alongside polling). */
  setReminderCreatedListener(handler: ReminderCreatedListener | null): void {
    this.onReminderCreated = handler;
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
    const created: ScheduledReminder = {
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
    if (this.onReminderCreated) {
      try {
        this.onReminderCreated(created);
      } catch (e) {
        console.error('[Reminders] onReminderCreated error:', e);
      }
    }
    return created;
  }

  /**
   * Atomically take the next due pending reminder for the given channels and mark it as processing.
   * Caller must later mark it sent or requeue it on failure.
   */
  claimNextDue(nowMs: number, channels?: ReminderChannel[]): ScheduledReminder | null {
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
      dbw.run(
        `UPDATE scheduled_reminders SET status = 'processing' WHERE id = ? AND status = 'pending'`,
        [id]
      );
      const ch = dbw.get('SELECT changes() as ch', []) as { ch: number } | undefined;
      dbw.run('COMMIT', []);
      if (!ch || ch.ch !== 1) {
        return null;
      }

      return this.mapRow(row, 'processing')!;
    } catch (e) {
      try {
        dbw.run('ROLLBACK', []);
      } catch {
        // ignore
      }
      throw e;
    }
  }

  private mapRow(
    row: Record<string, unknown> | undefined,
    status: ReminderStatus
  ): ScheduledReminder | null {
    if (!row) return null;
    return {
      id: String(row.id),
      userId: String(row.userId),
      runAtMs: Number(row.runAtMs),
      message: String(row.message),
      timezone: row.timezone != null ? String(row.timezone) : null,
      channel: (row.channel === 'telegram' ? 'telegram' : 'web') as ReminderChannel,
      targetRef: row.targetRef != null ? String(row.targetRef) : null,
      status,
      createdAtMs: Number(row.createdAtMs),
      sentAtMs: row.sentAtMs != null ? Number(row.sentAtMs) : null,
    };
  }

  /**
   * Claim a specific row if it is due and still pending (atomic). Used for one-shot timers alongside {@link claimNextDue}.
   */
  claimByIdIfDue(
    id: string,
    nowMs: number,
    channels?: ReminderChannel[]
  ): ScheduledReminder | null {
    const dbw = this.db.getDb();
    try {
      dbw.run('BEGIN IMMEDIATE', []);
      const channelFilter = channels && channels.length > 0 ? channels : null;
      const channelSql =
        channelFilter && channelFilter.length > 0
          ? ` AND channel IN (${channelFilter.map(() => '?').join(', ')})`
          : '';
      const selectParams = channelFilter ? [id, nowMs, ...channelFilter] : [id, nowMs];
      const row = dbw.get(
        `SELECT * FROM scheduled_reminders
         WHERE id = ? AND status = 'pending' AND runAtMs <= ?${channelSql}`,
        selectParams
      ) as Record<string, unknown> | undefined;

      if (!row) {
        dbw.run('COMMIT', []);
        return null;
      }

      const rowId = String(row.id);
      dbw.run(
        `UPDATE scheduled_reminders SET status = 'processing' WHERE id = ? AND status = 'pending'`,
        [rowId]
      );
      const ch = dbw.get('SELECT changes() as ch', []) as { ch: number } | undefined;
      dbw.run('COMMIT', []);
      if (!ch || ch.ch !== 1) {
        return null;
      }

      return this.mapRow(row, 'processing');
    } catch (e) {
      try {
        dbw.run('ROLLBACK', []);
      } catch {
        // ignore
      }
      throw e;
    }
  }

  markSent(id: string): void {
    this.run(
      `UPDATE scheduled_reminders
       SET status = 'sent', sentAtMs = ?
       WHERE id = ? AND status = 'processing'`,
      [Date.now(), id]
    );
  }

  requeue(id: string): void {
    this.run(
      `UPDATE scheduled_reminders
       SET status = 'pending'
       WHERE id = ? AND status = 'processing'`,
      [id]
    );
  }

  /**
   * Move stuck rows from `processing` back to `pending` (e.g. process crash or hung network after claim).
   * Only affects rows whose scheduled time is at least `minMsPastRunAt` in the past.
   */
  requeueStaleProcessing(minMsPastRunAt: number, nowMs: number = Date.now()): number {
    this.run(
      `UPDATE scheduled_reminders
       SET status = 'pending'
       WHERE status = 'processing' AND ? - runAtMs > ?`,
      [nowMs, minMsPastRunAt]
    );
    const ch = this.get<{ c: number }>('SELECT changes() as c', []);
    return ch?.c ?? 0;
  }

  getStatusCounts(): ReminderStatusCount[] {
    const rows = this.db
      .getDb()
      .all(
        `SELECT status, COUNT(*) as count
         FROM scheduled_reminders
         GROUP BY status`,
        []
      ) as Array<{ status: ReminderStatus; count: number }>;
    return rows.map((r) => ({ status: r.status, count: Number(r.count) }));
  }

  listDue(limit: number = 25, channels?: ReminderChannel[]): ScheduledReminder[] {
    const nowMs = Date.now();
    const channelFilter = channels && channels.length > 0 ? channels : null;
    const channelSql =
      channelFilter && channelFilter.length > 0
        ? ` AND channel IN (${channelFilter.map(() => '?').join(', ')})`
        : '';
    const params = channelFilter ? [nowMs, ...channelFilter, limit] : [nowMs, limit];
    const rows = this.db
      .getDb()
      .all(
        `SELECT * FROM scheduled_reminders
         WHERE status = 'pending' AND runAtMs <= ?${channelSql}
         ORDER BY runAtMs ASC
         LIMIT ?`,
        params
      ) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      userId: String(row.userId),
      runAtMs: Number(row.runAtMs),
      message: String(row.message),
      timezone: row.timezone != null ? String(row.timezone) : null,
      channel: (row.channel === 'telegram' ? 'telegram' : 'web') as ReminderChannel,
      targetRef: row.targetRef != null ? String(row.targetRef) : null,
      status: row.status as ReminderStatus,
      createdAtMs: Number(row.createdAtMs),
      sentAtMs: row.sentAtMs != null ? Number(row.sentAtMs) : null,
    }));
  }

  /**
   * All future or past (still pending) rows — used to re-arm one-shot timers after process restart.
   */
  listPendingScheduled(maxRows: number = 200, channels?: ReminderChannel[]): ScheduledReminder[] {
    const channelFilter = channels && channels.length > 0 ? channels : null;
    const channelSql =
      channelFilter && channelFilter.length > 0
        ? ` AND channel IN (${channelFilter.map(() => '?').join(', ')})`
        : '';
    const params = channelFilter ? [...channelFilter, maxRows] : [maxRows];
    const rows = this.db
      .getDb()
      .all(
        `SELECT * FROM scheduled_reminders
         WHERE status = 'pending'${channelSql}
         ORDER BY runAtMs ASC
         LIMIT ?`,
        params
      ) as Array<Record<string, unknown>>;
    return rows
      .map((row) => this.mapRow(row, 'pending'))
      .filter((r): r is ScheduledReminder => r != null);
  }
}
