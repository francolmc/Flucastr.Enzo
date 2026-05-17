import { DatabaseSync } from 'node:sqlite';
import { ConfigService } from '../config.js';

export interface Fact {
  key: string;
  value: string;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface Memory {
  getFacts(userId: string): Fact[];
  saveFact(userId: string, key: string, value: string): void;
  getTools(): Tool[];
  saveTool(tool: Tool): void;
}

export function createMemory(config: ConfigService): Memory {
  const db = new DatabaseSync(config.dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS facts (
      userId TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updatedAt INTEGER NOT NULL,
      PRIMARY KEY (userId, key)
    );

    CREATE TABLE IF NOT EXISTS tools (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      inputSchema TEXT NOT NULL
    );
  `);

  return {
    getFacts(userId) {
      const stmt = db.prepare('SELECT key, value FROM facts WHERE userId = ?');
      return stmt.all(userId) as unknown as Fact[];
    },

    saveFact(userId, key, value) {
      db.prepare(`
        INSERT INTO facts (userId, key, value, updatedAt)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(userId, key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt
      `).run(userId, key, value, Date.now());
    },

    getTools() {
      const rows = db.prepare('SELECT name, description, inputSchema FROM tools').all() as
        { name: string; description: string; inputSchema: string }[];
      return rows.map(row => ({
        name: row.name,
        description: row.description,
        inputSchema: JSON.parse(row.inputSchema),
      }));
    },

    saveTool(tool) {
      db.prepare(`
        INSERT INTO tools (name, description, inputSchema)
        VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET description = excluded.description, inputSchema = excluded.inputSchema
      `).run(tool.name, tool.description, JSON.stringify(tool.inputSchema));
    },
  };
}