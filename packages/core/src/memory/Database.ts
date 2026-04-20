import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

interface DbWrapper {
  run(sql: string, params: any[]): void;
  get(sql: string, params: any[]): any;
  all(sql: string, params: any[]): any[];
}

interface LegacyDbStore {
  conversations: any[];
  messages: any[];
  memories: any[];
  usage_stats: any[];
  agents: any[];
  conversation_agent_state: any[];
  skills_config: any[];
  mcp_servers: any[];
}

export class DatabaseManager {
  private static instance: DatabaseManager;
  private dbWrapper: DbWrapper | null = null;
  private sqlite: DatabaseSync | null = null;

  private constructor(private dbPath: string) {
    console.log(`[Database] Initializing database at: ${this.dbPath}`);
    this.initializeSqlite();
    this.dbWrapper = {
      run: (sql: string, params: any[]) => this.executeSql(sql, params),
      get: (sql: string, params: any[]) => this.getSql(sql, params),
      all: (sql: string, params: any[]) => this.allSql(sql, params),
    };
    console.log('[Database] Initialization complete. SQLite backend ready');
  }

  private initializeSqlite(): void {
    const resolved = path.resolve(this.dbPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });

    if (this.isLegacyJsonDatabase(resolved)) {
      this.migrateLegacyJsonToSqlite(resolved, resolved);
    }
    if (!fs.existsSync(resolved)) {
      const jsonCandidate = this.buildSiblingLegacyJsonPath(resolved);
      if (jsonCandidate && fs.existsSync(jsonCandidate) && this.isLegacyJsonDatabase(jsonCandidate)) {
        this.migrateLegacyJsonToSqlite(jsonCandidate, resolved);
      }
    }

    this.sqlite = new DatabaseSync(resolved);
    this.sqlite.exec('PRAGMA foreign_keys = ON;');
    this.sqlite.exec('PRAGMA journal_mode = WAL;');
    this.ensureSchema(this.sqlite);
  }

  private ensureSchema(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversationId TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        modelUsed TEXT,
        assistantMeta TEXT,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE
      );
    `);
    this.ensureColumnExists(db, 'messages', 'assistantMeta', 'TEXT');
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        UNIQUE(userId, key)
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS usage_stats (
        id TEXT PRIMARY KEY,
        requestId TEXT,
        conversationId TEXT NOT NULL,
        userId TEXT NOT NULL,
        source TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        inputTokens INTEGER NOT NULL,
        outputTokens INTEGER NOT NULL,
        estimatedCostUsd REAL NOT NULL,
        durationMs INTEGER NOT NULL,
        toolsUsed TEXT NOT NULL,
        complexityLevel TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
    `);
    this.ensureColumnExists(db, 'usage_stats', 'requestId', 'TEXT');
    this.ensureColumnExists(db, 'usage_stats', 'stageMetrics', 'TEXT');
    db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        systemPrompt TEXT,
        assistantNameOverride TEXT,
        personaOverride TEXT,
        toneOverride TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_agent_state (
        conversationId TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        agentId TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS skills_config (
        id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        transport TEXT NOT NULL,
        command TEXT,
        args TEXT,
        env TEXT,
        url TEXT,
        enabled INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
    `);

    db.exec('CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversationId, createdAt);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(userId, updatedAt DESC);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(userId);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_usage_stats_user_created ON usage_stats(userId, createdAt DESC);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_agents_user ON agents(userId, createdAt DESC);');
  }

  private buildSiblingLegacyJsonPath(sqlitePath: string): string | null {
    if (sqlitePath.endsWith('.db')) {
      return `${sqlitePath}.json`;
    }
    return null;
  }

  private ensureColumnExists(db: DatabaseSync, tableName: string, columnName: string, columnDefinition: string): void {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    const hasColumn = columns.some((column) => column.name === columnName);
    if (!hasColumn) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition};`);
    }
  }

  private isLegacyJsonDatabase(candidatePath: string): boolean {
    if (!fs.existsSync(candidatePath)) {
      return false;
    }
    try {
      const handle = fs.openSync(candidatePath, 'r');
      const buffer = Buffer.alloc(32);
      fs.readSync(handle, buffer, 0, 32, 0);
      fs.closeSync(handle);
      const prefix = buffer.toString('utf-8').trimStart();
      return prefix.startsWith('{') || prefix.startsWith('[');
    } catch (error) {
      console.warn(`[Database] Failed to detect format for ${candidatePath}:`, error);
      return false;
    }
  }

  private toLegacyStore(parsed: any): LegacyDbStore {
    return {
      conversations: Array.isArray(parsed?.conversations) ? parsed.conversations : [],
      messages: Array.isArray(parsed?.messages) ? parsed.messages : [],
      memories: Array.isArray(parsed?.memories) ? parsed.memories : [],
      usage_stats: Array.isArray(parsed?.usage_stats) ? parsed.usage_stats : [],
      agents: Array.isArray(parsed?.agents) ? parsed.agents : [],
      conversation_agent_state: Array.isArray(parsed?.conversation_agent_state) ? parsed.conversation_agent_state : [],
      skills_config: Array.isArray(parsed?.skills_config) ? parsed.skills_config : [],
      mcp_servers: Array.isArray(parsed?.mcp_servers) ? parsed.mcp_servers : [],
    };
  }

  private buildBackupPath(sourcePath: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${sourcePath}.legacy-${timestamp}.json`;
  }

  private migrateLegacyJsonToSqlite(sourcePath: string, targetPath: string): void {
    console.log(`[Database] Migrating legacy JSON data from ${sourcePath} to ${targetPath}`);

    const parsed = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
    const store = this.toLegacyStore(parsed);
    const sourceIsTarget = path.resolve(sourcePath) === path.resolve(targetPath);

    let sourceForImport = sourcePath;
    if (sourceIsTarget) {
      const backupPath = this.buildBackupPath(sourcePath);
      fs.renameSync(sourcePath, backupPath);
      sourceForImport = backupPath;
      console.log(`[Database] Legacy JSON moved to backup: ${backupPath}`);
    } else {
      const backupPath = this.buildBackupPath(sourcePath);
      fs.copyFileSync(sourcePath, backupPath);
      sourceForImport = sourcePath;
      console.log(`[Database] Legacy JSON backup copy created at: ${backupPath}`);
    }

    const importDb = new DatabaseSync(targetPath);
    try {
      this.ensureSchema(importDb);
      importDb.exec('BEGIN;');

      const insertConversation = importDb.prepare(
        'INSERT OR IGNORE INTO conversations (id, userId, createdAt, updatedAt) VALUES (?, ?, ?, ?)'
      );
      for (const row of store.conversations) {
        insertConversation.run(
          row.id,
          row.userId,
          Number(row.createdAt ?? Date.now()),
          Number(row.updatedAt ?? row.createdAt ?? Date.now())
        );
      }

      const insertMessage = importDb.prepare(
        'INSERT OR IGNORE INTO messages (id, conversationId, role, content, modelUsed, assistantMeta, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      for (const row of store.messages) {
        insertMessage.run(
          row.id,
          row.conversationId,
          row.role,
          row.content ?? '',
          row.modelUsed ?? null,
          row.assistantMeta ?? null,
          Number(row.createdAt ?? Date.now())
        );
      }

      const insertMemory = importDb.prepare(
        'INSERT OR REPLACE INTO memories (id, userId, key, value, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)'
      );
      for (const row of store.memories) {
        insertMemory.run(
          row.id,
          row.userId,
          row.key,
          row.value ?? '',
          Number(row.createdAt ?? Date.now()),
          Number(row.updatedAt ?? row.createdAt ?? Date.now())
        );
      }

      const insertUsage = importDb.prepare(
        `INSERT OR IGNORE INTO usage_stats
         (id, requestId, conversationId, userId, source, provider, model, inputTokens, outputTokens, estimatedCostUsd, durationMs, stageMetrics, toolsUsed, complexityLevel, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const row of store.usage_stats) {
        const toolsUsed =
          typeof row.toolsUsed === 'string'
            ? row.toolsUsed
            : JSON.stringify(Array.isArray(row.toolsUsed) ? row.toolsUsed : []);
        insertUsage.run(
          row.id,
          row.requestId ?? null,
          row.conversationId,
          row.userId,
          row.source ?? 'unknown',
          row.provider ?? 'unknown',
          row.model ?? 'unknown',
          Number(row.inputTokens ?? 0),
          Number(row.outputTokens ?? 0),
          Number(row.estimatedCostUsd ?? 0),
          Number(row.durationMs ?? 0),
          row.stageMetrics ? JSON.stringify(row.stageMetrics) : null,
          toolsUsed,
          row.complexityLevel ?? 'UNKNOWN',
          Number(row.createdAt ?? Date.now())
        );
      }

      const insertAgent = importDb.prepare(
        `INSERT OR IGNORE INTO agents
         (id, userId, name, description, provider, model, systemPrompt, assistantNameOverride, personaOverride, toneOverride, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const row of store.agents) {
        insertAgent.run(
          row.id,
          row.userId,
          row.name,
          row.description ?? null,
          row.provider,
          row.model,
          row.systemPrompt ?? null,
          row.assistantNameOverride ?? null,
          row.personaOverride ?? null,
          row.toneOverride ?? null,
          Number(row.createdAt ?? Date.now()),
          Number(row.updatedAt ?? row.createdAt ?? Date.now())
        );
      }

      const insertConversationAgent = importDb.prepare(
        'INSERT OR REPLACE INTO conversation_agent_state (conversationId, userId, agentId, updatedAt) VALUES (?, ?, ?, ?)'
      );
      for (const row of store.conversation_agent_state) {
        insertConversationAgent.run(
          row.conversationId,
          row.userId,
          row.agentId,
          Number(row.updatedAt ?? Date.now())
        );
      }

      const insertSkillConfig = importDb.prepare(
        'INSERT OR REPLACE INTO skills_config (id, enabled, createdAt, updatedAt) VALUES (?, ?, ?, ?)'
      );
      for (const row of store.skills_config) {
        insertSkillConfig.run(
          row.id,
          row.enabled ? 1 : 0,
          Number(row.createdAt ?? Date.now()),
          Number(row.updatedAt ?? row.createdAt ?? Date.now())
        );
      }

      const insertMcpServer = importDb.prepare(
        `INSERT OR REPLACE INTO mcp_servers
         (id, name, description, transport, command, args, env, url, enabled, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const row of store.mcp_servers) {
        const args = typeof row.args === 'string' ? row.args : row.args ? JSON.stringify(row.args) : null;
        const env = typeof row.env === 'string' ? row.env : row.env ? JSON.stringify(row.env) : null;
        insertMcpServer.run(
          row.id,
          row.name,
          row.description ?? null,
          row.transport,
          row.command ?? null,
          args,
          env,
          row.url ?? null,
          row.enabled ? 1 : 0,
          Number(row.createdAt ?? Date.now()),
          Number(row.updatedAt ?? row.createdAt ?? Date.now())
        );
      }

      importDb.exec('COMMIT;');
      console.log(`[Database] Legacy migration completed (${sourceForImport})`);
    } catch (error) {
      importDb.exec('ROLLBACK;');
      console.error('[Database] Legacy migration failed:', error);
      throw error;
    } finally {
      importDb.close();
    }
  }

  private getDatabase(): DatabaseSync {
    if (!this.sqlite) {
      throw new Error('Database not initialized');
    }
    return this.sqlite;
  }

  private executeSql(sql: string, params: any[]): void {
    const statement = this.getDatabase().prepare(sql);
    statement.run(...params);
  }

  private getSql(sql: string, params: any[]): any {
    const statement = this.getDatabase().prepare(sql);
    return statement.get(...params);
  }

  private allSql(sql: string, params: any[]): any[] {
    const statement = this.getDatabase().prepare(sql);
    return statement.all(...params) as any[];
  }

  static getInstance(dbPath?: string): DatabaseManager {
    if (!DatabaseManager.instance) {
      const resolvedPath = dbPath || process.env.DB_PATH || './enzo.db';
      DatabaseManager.instance = new DatabaseManager(resolvedPath);
    }
    return DatabaseManager.instance;
  }

  getDb(): DbWrapper {
    if (!this.dbWrapper) {
      throw new Error('Database not initialized');
    }
    return this.dbWrapper;
  }

  close(): void {
    if (this.sqlite) {
      this.sqlite.close();
      this.sqlite = null;
    }
  }
}
