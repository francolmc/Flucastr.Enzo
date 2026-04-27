import type { DatabaseSync } from 'node:sqlite';
import { normalizeMemoryKey, type MemoryKey } from '../MemoryKeys.js';

type MemoryRow = {
  id: string;
  userId: string;
  key: string;
  value: string;
  createdAt: number;
  updatedAt: number;
};

type MergedRow = MemoryRow & { key: MemoryKey };

/**
 * Reescribe claves de `memories` a forma canónica y fusiona duplicados
 * (mismo userId + key normalizada) conservando el registro con updatedAt más alto.
 */
export function migrateMemoryKeysIfNeeded(db: DatabaseSync): void {
  const rows = db
    .prepare('SELECT id, userId, key, value, createdAt, updatedAt FROM memories')
    .all() as MemoryRow[];

  if (rows.length === 0) {
    return;
  }

  const countsByUserCanonical = new Map<string, number>();
  for (const r of rows) {
    const gk = `${r.userId}\0${normalizeMemoryKey(r.key)}`;
    countsByUserCanonical.set(gk, (countsByUserCanonical.get(gk) ?? 0) + 1);
  }

  const hasNonCanonicalKey = rows.some((r) => r.key !== normalizeMemoryKey(r.key));
  const hasCollisions = [...countsByUserCanonical.values()].some((c) => c > 1);

  if (!hasNonCanonicalKey && !hasCollisions) {
    return;
  }

  const merged = new Map<string, MergedRow>();
  for (const r of rows) {
    const canon = normalizeMemoryKey(r.key);
    const gk = `${r.userId}\0${canon}`;
    const current = merged.get(gk);
    if (!current || r.updatedAt > current.updatedAt) {
      merged.set(gk, {
        ...r,
        key: canon,
      });
    }
  }

  const out = [...merged.values()];

  try {
    db.exec('BEGIN');
    db.exec('DELETE FROM memories');
    const insert = db.prepare(
      'INSERT INTO memories (id, userId, key, value, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const r of out) {
      insert.run(r.id, r.userId, r.key, r.value, r.createdAt, r.updatedAt);
    }
    db.exec('COMMIT');
    console.log(
      `[Database] Memory keys migration: ${rows.length} row(s) -> ${out.length} row(s) (canonical keys)`
    );
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
