import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../memory/Database.js';
import type {
  CalendarEventRow,
  CalendarInsertInput,
  CalendarUpdateInput,
} from './types.js';

function mapRow(raw: Record<string, unknown>): CalendarEventRow {
  const endRaw = raw.endAt;
  return {
    id: String(raw.id),
    userId: String(raw.userId),
    title: String(raw.title),
    startAt: Number(raw.startAt),
    endAt: endRaw === null || endRaw === undefined ? null : Number(endRaw),
    notes: raw.notes == null ? null : String(raw.notes),
    createdAt: Number(raw.createdAt),
    updatedAt: Number(raw.updatedAt),
  };
}

/**
 * Persisted agenda entries per Enzo user. Uses the same SQLite file as MemoryService via DatabaseManager.
 */
export class CalendarService {
  private readonly dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || process.env.DB_PATH || './enzo.db';
    DatabaseManager.getInstance(this.dbPath);
  }

  private run(sql: string, params: unknown[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        DatabaseManager.getInstance().getDb().run(sql, params);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  private get(sql: string, params: unknown[] = []): Promise<Record<string, unknown> | undefined> {
    return new Promise((resolve, reject) => {
      try {
        const row = DatabaseManager.getInstance().getDb().get(sql, params);
        resolve(row as Record<string, unknown> | undefined);
      } catch (e) {
        reject(e);
      }
    });
  }

  private all(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      try {
        const rows = DatabaseManager.getInstance().getDb().all(sql, params) as Record<string, unknown>[];
        resolve(rows ?? []);
      } catch (e) {
        reject(e);
      }
    });
  }

  async insert(userId: string, input: CalendarInsertInput): Promise<CalendarEventRow> {
    const now = Date.now();
    const id = uuidv4();
    await this.run(
      `INSERT INTO calendar_events (id, userId, title, startAt, endAt, notes, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        input.title.trim(),
        input.startAt,
        input.endAt ?? null,
        input.notes?.trim() || null,
        now,
        now,
      ]
    );
    const row = await this.get(
      `SELECT id, userId, title, startAt, endAt, notes, createdAt, updatedAt FROM calendar_events WHERE id = ? AND userId = ?`,
      [id, userId]
    );
    if (!row) {
      throw new Error('calendar insert failed');
    }
    return mapRow(row);
  }

  async listInRange(userId: string, fromMs: number, toMs: number): Promise<CalendarEventRow[]> {
    const rows = await this.all(
      `SELECT id, userId, title, startAt, endAt, notes, createdAt, updatedAt
       FROM calendar_events
       WHERE userId = ?
         AND startAt >= ?
         AND startAt <= ?
       ORDER BY startAt ASC`,
      [userId, fromMs, toMs]
    );
    return rows.map(mapRow);
  }

  async getById(userId: string, id: string): Promise<CalendarEventRow | undefined> {
    const row = await this.get(
      `SELECT id, userId, title, startAt, endAt, notes, createdAt, updatedAt FROM calendar_events WHERE id = ? AND userId = ?`,
      [id, userId]
    );
    return row ? mapRow(row) : undefined;
  }

  async update(userId: string, id: string, patch: CalendarUpdateInput): Promise<CalendarEventRow | undefined> {
    const existing = await this.getById(userId, id);
    if (!existing) {
      return undefined;
    }
    const title = patch.title !== undefined ? patch.title.trim() : existing.title;
    const startAt = patch.startAt !== undefined ? patch.startAt : existing.startAt;
    const endAt = patch.endAt !== undefined ? patch.endAt : existing.endAt;
    const notes =
      patch.notes !== undefined
        ? patch.notes === null
          ? null
          : String(patch.notes).trim() || null
        : existing.notes;
    const now = Date.now();
    await this.run(
      `UPDATE calendar_events SET title = ?, startAt = ?, endAt = ?, notes = ?, updatedAt = ? WHERE id = ? AND userId = ?`,
      [title, startAt, endAt, notes, now, id, userId]
    );
    return this.getById(userId, id);
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const before = await this.getById(userId, id);
    if (!before) {
      return false;
    }
    await this.run(`DELETE FROM calendar_events WHERE id = ? AND userId = ?`, [id, userId]);
    const after = await this.getById(userId, id);
    return !after;
  }
}
