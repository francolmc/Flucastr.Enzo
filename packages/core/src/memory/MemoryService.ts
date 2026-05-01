import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from './Database.js';
import { normalizeMemoryKey } from './MemoryKeys.js';
import { Message } from '../providers/types.js';
import {
  Memory,
  MemoryLesson,
  RememberOptions,
  SaveMemoryLessonInput,
  UsageStat,
  MessageRecord,
  ConversationRecord,
  ConversationSummaryRecord,
  AgentRecord,
  AssistantMessageMetadata,
  MemoryEntrySource,
  MemoryHistoryItem,
} from './types.js';
import {
  rankMemoriesByLexicalSimilarity,
  parseMemoryRecallTopK,
  selectLessonsForUserMessage,
  parseLessonsPoolMax,
} from './MemoryRecallRank.js';
import { recordMemoryRecallTurn } from './MemoryMetrics.js';
import { MCPServerConfig } from '../mcp/types.js';

export class MemoryService {
  private db: DatabaseManager;
  private readonly resolvedDbPath: string;

  constructor(dbPath?: string) {
    this.resolvedDbPath = dbPath || process.env.DB_PATH || './enzo.db';
    this.db = DatabaseManager.getInstance(dbPath);
  }

  /** Same path used to open the DB. */
  getDbPath(): string {
    return this.resolvedDbPath;
  }

  private runAsync(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.db.getDb().run(sql, params);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  private getAsync(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      try {
        const result = this.db.getDb().get(sql, params);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  }

  private allAsync(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      try {
        const results = this.db.getDb().all(sql, params);
        resolve(results || []);
      } catch (err) {
        reject(err);
      }
    });
  }

  // Historial conversacional (últimos `limit` mensajes, orden cronológico ASC para el LLM)
  async getHistory(conversationId: string, limit: number = 200): Promise<Message[]> {
    const rows = await this.allAsync(
      `SELECT role, content FROM messages
       WHERE conversationId = ?
       ORDER BY createdAt DESC
       LIMIT ?`,
      [conversationId, limit]
    );

    const chronological = [...rows].reverse();
    return chronological.map(row => ({
      role: row.role as 'user' | 'assistant' | 'system',
      content: row.content,
    }));
  }

  async getHistoryWithMetadata(conversationId: string, limit: number = 200): Promise<MessageRecord[]> {
    const rows = await this.allAsync(
      `SELECT id, conversationId, role, content, modelUsed, assistantMeta, createdAt FROM messages
       WHERE conversationId = ?
       ORDER BY createdAt DESC
       LIMIT ?`,
      [conversationId, limit]
    );

    const chronological = [...rows].reverse();
    return chronological.map(row => {
      const assistantMeta = this.safeParseAssistantMeta(row.assistantMeta);
      return {
        id: row.id,
        conversationId: row.conversationId,
        role: row.role as 'user' | 'assistant' | 'system',
        content: row.content,
        modelUsed: row.modelUsed || assistantMeta.modelUsed,
        complexityUsed: assistantMeta.complexityUsed,
        durationMs: assistantMeta.durationMs,
        injectedSkills: assistantMeta.injectedSkills,
        createdAt: row.createdAt,
      };
    });
  }

  async saveMessage(
    conversationId: string,
    message: Message,
    modelUsed?: string,
    assistantMeta?: AssistantMessageMetadata
  ): Promise<void> {
    const id = uuidv4();
    const now = Date.now();
    const serializedAssistantMeta = assistantMeta ? JSON.stringify(assistantMeta) : null;

    await this.runAsync(
      `INSERT INTO messages (id, conversationId, role, content, modelUsed, assistantMeta, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, conversationId, message.role, message.content, modelUsed || null, serializedAssistantMeta, now]
    );

    await this.runAsync(
      `UPDATE conversations SET updatedAt = ? WHERE id = ?`,
      [now, conversationId]
    );
  }

  async ensureConversation(conversationId: string, userId: string): Promise<void> {
    const now = Date.now();
    await this.runAsync(
      `INSERT OR IGNORE INTO conversations (id, userId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?)`,
      [conversationId, userId, now, now]
    );
  }

  async clearHistory(conversationId: string): Promise<void> {
    console.log(`[Memory] Clearing history for conversationId: ${conversationId}`);
    await this.runAsync(
      `DELETE FROM messages WHERE conversationId = ?`,
      [conversationId]
    );
    await this.runAsync(`DELETE FROM conversation_summaries WHERE conversationId = ?`, [conversationId]);
    console.log(`[Memory] History cleared for conversationId: ${conversationId}`);
  }

  async getConversationSummary(conversationId: string): Promise<ConversationSummaryRecord | null> {
    const row = await this.getAsync(
      `SELECT conversationId, summary, upToMessageId, upToCreatedAt, topicHint, updatedAt
       FROM conversation_summaries WHERE conversationId = ?`,
      [conversationId]
    );
    if (!row) return null;
    return {
      conversationId: row.conversationId,
      summary: row.summary,
      upToMessageId: row.upToMessageId,
      upToCreatedAt: row.upToCreatedAt,
      topicHint: row.topicHint || undefined,
      updatedAt: row.updatedAt,
    };
  }

  async upsertConversationSummary(record: Omit<ConversationSummaryRecord, 'updatedAt'> & { updatedAt?: number }): Promise<void> {
    const now = record.updatedAt ?? Date.now();
    await this.runAsync(
      `INSERT INTO conversation_summaries (conversationId, summary, upToMessageId, upToCreatedAt, topicHint, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(conversationId) DO UPDATE SET
         summary = excluded.summary,
         upToMessageId = excluded.upToMessageId,
         upToCreatedAt = excluded.upToCreatedAt,
         topicHint = excluded.topicHint,
         updatedAt = excluded.updatedAt`,
      [
        record.conversationId,
        record.summary,
        record.upToMessageId,
        record.upToCreatedAt,
        record.topicHint ?? null,
        now,
      ]
    );
  }

  async resetConversationContext(conversationId: string, userId: string): Promise<void> {
    await this.clearHistory(conversationId);
    await this.setConversationActiveAgent(conversationId, userId, undefined);
  }

  async createConversation(userId: string): Promise<string> {
    const id = uuidv4();
    const now = Date.now();

    await this.runAsync(
      `INSERT INTO conversations (id, userId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?)`,
      [id, userId, now, now]
    );

    return id;
  }

  private mapEntryRow(row: {
    id: string;
    userId: string;
    key: string;
    value: string;
    createdAt: number;
    updatedAt: number;
    source: string;
    confidence: number;
  }): Memory {
    const src = row.source as MemoryEntrySource;
    const allowed: MemoryEntrySource[] = ['extractor', 'tool', 'api', 'migrated'];
    return {
      id: row.id,
      userId: row.userId,
      key: row.key,
      value: row.value,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      source: allowed.includes(src) ? src : undefined,
      confidence: typeof row.confidence === 'number' ? row.confidence : undefined,
    };
  }

  /**
   * Active profile memories for prompts: optional lexical top‑k vs current user message
   * (ENZO_MEMORY_RECALL_TOP_K). When absent or 0, returns full active set.
   */
  async recallRankedForPrompt(
    userId: string,
    queryHint: string | undefined,
    opts?: { recordMetrics?: boolean }
  ): Promise<Memory[]> {
    const all = await this.recall(userId);
    const topK = parseMemoryRecallTopK();
    const q = (queryHint ?? '').trim();
    let selected = all;
    if (q.length > 0 && topK > 0 && all.length > topK) {
      selected = rankMemoriesByLexicalSimilarity(q, all, topK);
      if (opts?.recordMetrics !== false) {
        recordMemoryRecallTurn({ mode: 'ranked', returnedCountDelta: selected.length });
      }
    } else if (opts?.recordMetrics !== false) {
      recordMemoryRecallTurn({ mode: 'full', returnedCountDelta: all.length });
    }
    return selected;
  }

  // Memoria semántica (memory_entries + mirror en `memories` por compatibilidad)
  async remember(userId: string, key: string, value: string, options?: RememberOptions): Promise<void> {
    const canonicalKey = normalizeMemoryKey(key);
    const source: MemoryEntrySource = options?.source ?? 'tool';
    const confidence =
      typeof options?.confidence === 'number' && Number.isFinite(options.confidence)
        ? Math.min(0.99, Math.max(0, options.confidence))
        : 0.85;
    console.log(`[Memory] Guardando: ${userId} → ${canonicalKey}: ${value} (source=${source})`);
    const now = Date.now();
    const newId = uuidv4();

    await this.runAsync(
      `UPDATE memory_entries SET active = 0, updatedAt = ? WHERE userId = ? AND key = ? AND active = 1`,
      [now, userId, canonicalKey]
    );

    await this.runAsync(
      `INSERT INTO memory_entries (id, userId, key, value, source, confidence, active, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [newId, userId, canonicalKey, value, source, confidence, now, now]
    );

    const existing = await this.getAsync(`SELECT id FROM memories WHERE userId = ? AND key = ?`, [userId, canonicalKey]);

    if (existing) {
      console.log(`[Memory] Mirror actualizando memories id → ${newId}`);
      await this.runAsync(`UPDATE memories SET id = ?, value = ?, updatedAt = ? WHERE userId = ? AND key = ?`, [
        newId,
        value,
        now,
        userId,
        canonicalKey,
      ]);
    } else {
      console.log(`[Memory] Mirror insert memories id=${newId}`);
      await this.runAsync(
        `INSERT INTO memories (id, userId, key, value, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [newId, userId, canonicalKey, value, now, now]
      );
    }
  }

  async recall(userId: string, key?: string): Promise<Memory[]> {
    if (key) {
      const canonicalKey = normalizeMemoryKey(key);
      const rows = await this.allAsync(
        `SELECT id, userId, key, value, source, confidence, createdAt, updatedAt FROM memory_entries
         WHERE userId = ? AND key = ? AND active = 1`,
        [userId, canonicalKey]
      );
      if (rows.length > 0) {
        return rows.map((r) =>
          this.mapEntryRow(
            r as {
              id: string;
              userId: string;
              key: string;
              value: string;
              source: string;
              confidence: number;
              createdAt: number;
              updatedAt: number;
            }
          )
        );
      }
      const legacy = await this.allAsync(
        `SELECT id, userId, key, value, createdAt, updatedAt FROM memories
         WHERE userId = ? AND key = ?`,
        [userId, canonicalKey]
      );
      return legacy as Memory[];
    }

    const rows = await this.allAsync(
      `SELECT id, userId, key, value, source, confidence, createdAt, updatedAt FROM memory_entries
       WHERE userId = ? AND active = 1 ORDER BY key ASC`,
      [userId]
    );
    if (rows.length > 0) {
      return rows.map((r) =>
        this.mapEntryRow(
          r as {
            id: string;
            userId: string;
            key: string;
            value: string;
            source: string;
            confidence: number;
            createdAt: number;
            updatedAt: number;
          }
        )
      );
    }

    const legacy = await this.allAsync(
      `SELECT id, userId, key, value, createdAt, updatedAt FROM memories
       WHERE userId = ? ORDER BY key ASC`,
      [userId]
    );
    return legacy as Memory[];
  }

  async recallMemoryHistory(userId: string, key: string): Promise<MemoryHistoryItem[]> {
    const canonicalKey = normalizeMemoryKey(key);
    const rows = await this.allAsync(
      `SELECT id, userId, key, value, source, confidence, active, createdAt, updatedAt
       FROM memory_entries WHERE userId = ? AND key = ?
       ORDER BY active DESC, updatedAt DESC`,
      [userId, canonicalKey]
    );
    if (rows.length > 0) {
      return (rows as any[]).map((r: any) => ({
        ...this.mapEntryRow(r),
        isCurrent: r.active === 1,
      }));
    }
    const legacy = await this.getAsync(
      `SELECT id, userId, key, value, createdAt, updatedAt FROM memories WHERE userId = ? AND key = ?`,
      [userId, canonicalKey]
    );
    if (!legacy) {
      return [];
    }
    return [
      {
        id: legacy.id,
        userId: legacy.userId,
        key: legacy.key,
        value: legacy.value,
        createdAt: legacy.createdAt,
        updatedAt: legacy.updatedAt,
        isCurrent: true,
      },
    ];
  }

  /** When `currentUserMessage` is set and ENZO_LESSONS_RECALL_TOP_K > 0, ranks lessons vs message (pinned recent + lexical top‑k). */
  async buildLessonsBlock(userId: string, currentUserMessage?: string): Promise<string> {
    const pool = parseLessonsPoolMax();
    const lessons = await this.recallActiveLessons(userId, pool);
    if (lessons.length === 0) {
      return '';
    }
    const picked = selectLessonsForUserMessage(lessons, currentUserMessage);
    const lines = picked.map(
      (l) =>
        `- [${l.source}] ${l.situation.trim()} — avoid: ${l.avoid.trim()}; prefer: ${l.prefer.trim()}`
    );
    return `[LESSONS_FROM_PRIOR_RUNS — scoped to this user]
${lines.join('\n')}
Use only when relevant to the current request; never invent new failures from this list.`;
  }

  async recallActiveLessons(userId: string, limit = 20): Promise<MemoryLesson[]> {
    const rows = await this.allAsync(
      `SELECT id, userId, situation, avoid, prefer, source, confidence, conversationId, requestId, active,
              createdAt, updatedAt FROM memory_lessons
       WHERE userId = ? AND active = 1
       ORDER BY updatedAt DESC
       LIMIT ?`,
      [userId, limit]
    );
    return (rows || []).map((row: any) => ({
      id: row.id,
      userId: row.userId,
      situation: row.situation,
      avoid: row.avoid,
      prefer: row.prefer,
      source: row.source as MemoryLesson['source'],
      confidence: row.confidence,
      conversationId: row.conversationId || undefined,
      requestId: row.requestId || undefined,
      active: Boolean(row.active),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async saveMemoryLesson(input: SaveMemoryLessonInput): Promise<void> {
    const cap = Number(process.env.ENZO_MEMORY_LESSON_MAX_ACTIVE ?? '25');
    const maxActive = Number.isFinite(cap) ? Math.min(100, Math.max(1, Math.floor(cap))) : 25;
    const id = uuidv4();
    const now = Date.now();
    await this.runAsync(
      `INSERT INTO memory_lessons (id, userId, situation, avoid, prefer, source, confidence, conversationId, requestId, active, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        id,
        input.userId,
        input.situation,
        input.avoid,
        input.prefer,
        input.source,
        input.confidence,
        input.conversationId ?? null,
        input.requestId ?? null,
        now,
        now,
      ]
    );

    const countRow = await this.getAsync(
      `SELECT COUNT(*) as c FROM memory_lessons WHERE userId = ? AND active = 1`,
      [input.userId]
    );
    const c = typeof countRow?.c === 'number' ? countRow.c : 0;
    if (c > maxActive) {
      const excess = await this.allAsync(
        `SELECT id FROM memory_lessons WHERE userId = ? AND active = 1 ORDER BY updatedAt ASC LIMIT ?`,
        [input.userId, c - maxActive]
      );
      for (const row of excess) {
        await this.runAsync(`UPDATE memory_lessons SET active = 0, updatedAt = ? WHERE id = ?`, [Date.now(), row.id]);
      }
    }
  }

  // Estadísticas
  async saveStats(stats: UsageStat): Promise<void> {
    console.log('[MemoryService] saveStats called with:', {
      id: stats.id,
      userId: stats.userId,
      complexityLevel: stats.complexityLevel,
    });
    await this.runAsync(
      `INSERT INTO usage_stats (
        id, requestId, conversationId, userId, source, provider, model, inputTokens, outputTokens,
        estimatedCostUsd, durationMs, stageMetrics, toolsUsed, complexityLevel, createdAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        stats.id,
        stats.requestId || null,
        stats.conversationId,
        stats.userId,
        stats.source,
        stats.provider,
        stats.model,
        stats.inputTokens,
        stats.outputTokens,
        stats.estimatedCostUsd,
        stats.durationMs,
        stats.stageMetrics || stats.continuity
          ? JSON.stringify({
              ...(stats.stageMetrics ?? {}),
              ...(stats.continuity ? { continuityContext: stats.continuity } : {}),
            })
          : null,
        JSON.stringify(stats.toolsUsed),
        stats.complexityLevel,
        stats.createdAt
      ]
    );
    console.log('[MemoryService] saveStats completed');
  }

  async getStats(
    userId?: string,
    from?: number,
    to?: number,
    source?: 'web' | 'telegram' | 'unknown'
  ): Promise<UsageStat[]> {
    let query = 'SELECT * FROM usage_stats WHERE 1=1';
    const params: any[] = [];

    if (userId) {
      query += ' AND userId = ?';
      params.push(userId);
    }

    if (from !== undefined) {
      query += ' AND createdAt >= ?';
      params.push(from);
    }

    if (to !== undefined) {
      query += ' AND createdAt <= ?';
      params.push(to);
    }

    query += ' ORDER BY createdAt DESC';

    const rows = await this.allAsync(query, params);

    const mapped = rows.map(row => ({
      id: row.id,
      requestId: row.requestId || undefined,
      conversationId: row.conversationId,
      userId: row.userId,
      source: row.source || 'unknown',
      provider: row.provider,
      model: row.model,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      estimatedCostUsd: typeof row.estimatedCostUsd === 'number' ? row.estimatedCostUsd : 0,
      durationMs: row.durationMs,
      stageMetrics: this.safeParseStageMetrics(row.stageMetrics),
      toolsUsed: this.safeParseToolsUsed(row.toolsUsed),
      complexityLevel: row.complexityLevel,
      createdAt: row.createdAt,
    }));

    if (!source) {
      return mapped;
    }

    if (source === 'unknown') {
      return mapped.filter((row) => !row.source || row.source === 'unknown');
    }

    return mapped.filter((row) => row.source === source);
  }

  private safeParseToolsUsed(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value as string[];
    }

    if (typeof value !== 'string') {
      return [];
    }

    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private safeParseAssistantMeta(value: unknown): AssistantMessageMetadata {
    if (typeof value !== 'string' || value.length === 0) {
      return {};
    }

    try {
      const parsed = JSON.parse(value) as AssistantMessageMetadata;
      if (!parsed || typeof parsed !== 'object') {
        return {};
      }

      return {
        modelUsed: typeof parsed.modelUsed === 'string' ? parsed.modelUsed : undefined,
        complexityUsed: typeof parsed.complexityUsed === 'string' ? parsed.complexityUsed : undefined,
        durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : undefined,
        injectedSkills: Array.isArray(parsed.injectedSkills) ? parsed.injectedSkills : undefined,
      };
    } catch {
      return {};
    }
  }

  private safeParseStageMetrics(
    value: unknown
  ): UsageStat['stageMetrics'] | undefined {
    if (typeof value !== 'string' || value.length === 0) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object') {
        return undefined;
      }
      return parsed as UsageStat['stageMetrics'];
    } catch {
      return undefined;
    }
  }

  // Agentes
  async saveAgent(agent: AgentRecord): Promise<void> {
    await this.runAsync(
      `INSERT INTO agents (id, userId, name, description, provider, model, systemPrompt, assistantNameOverride, personaOverride, toneOverride, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        agent.id,
        agent.userId,
        agent.name,
        agent.description || null,
        agent.provider,
        agent.model,
        agent.systemPrompt || null,
        agent.assistantNameOverride || null,
        agent.personaOverride || null,
        agent.toneOverride || null,
        agent.createdAt,
        agent.updatedAt
      ]
    );
  }

  async getAgents(userId: string): Promise<AgentRecord[]> {
    return this.allAsync(
      `SELECT id, userId, name, description, provider, model, systemPrompt, assistantNameOverride, personaOverride, toneOverride, createdAt, updatedAt
       FROM agents
       WHERE userId = ?
       ORDER BY createdAt DESC`,
      [userId]
    );
  }

  async getAllAgents(): Promise<AgentRecord[]> {
    return this.allAsync(
      `SELECT id, userId, name, description, provider, model, systemPrompt, assistantNameOverride, personaOverride, toneOverride, createdAt, updatedAt
       FROM agents
       ORDER BY createdAt DESC`,
      []
    );
  }

  async getAgent(id: string): Promise<AgentRecord | null> {
    const row = await this.getAsync(
      `SELECT id, userId, name, description, provider, model, systemPrompt, assistantNameOverride, personaOverride, toneOverride, createdAt, updatedAt
       FROM agents
       WHERE id = ?`,
      [id]
    );
    return row || null;
  }

  async updateAgent(id: string, data: Partial<AgentRecord>): Promise<AgentRecord | null> {
    const agent = await this.getAgent(id);
    
    if (!agent) {
      return null;
    }

    const now = Date.now();
    const updated: AgentRecord = {
      ...agent,
      ...data,
      id: agent.id,
      userId: agent.userId,
      createdAt: agent.createdAt,
      updatedAt: now,
    };

    await this.runAsync(
      `UPDATE agents
       SET name = ?, description = ?, provider = ?, model = ?, systemPrompt = ?, assistantNameOverride = ?, personaOverride = ?, toneOverride = ?, updatedAt = ?
       WHERE id = ?`,
      [
        updated.name,
        updated.description || null,
        updated.provider,
        updated.model,
        updated.systemPrompt || null,
        updated.assistantNameOverride || null,
        updated.personaOverride || null,
        updated.toneOverride || null,
        updated.updatedAt,
        id
      ]
    );

    return updated;
  }

  async deleteAgent(id: string): Promise<void> {
    await this.runAsync(
      `DELETE FROM agents WHERE id = ?`,
      [id]
    );
  }

  async setConversationActiveAgent(
    conversationId: string,
    userId: string,
    agentId?: string
  ): Promise<void> {
    await this.runAsync(
      `DELETE FROM conversation_agent_state WHERE conversationId = ?`,
      [conversationId]
    );

    if (!agentId) {
      return;
    }

    await this.runAsync(
      `INSERT INTO conversation_agent_state (conversationId, userId, agentId, updatedAt)
       VALUES (?, ?, ?, ?)`,
      [conversationId, userId, agentId, Date.now()]
    );
  }

  async getConversationActiveAgent(conversationId: string): Promise<string | undefined> {
    const row = await this.getAsync(
      `SELECT agentId FROM conversation_agent_state WHERE conversationId = ?`,
      [conversationId]
    );
    return row?.agentId || undefined;
  }

  async deleteMemory(userId: string, key: string): Promise<void> {
    const canonicalKey = normalizeMemoryKey(key);
    const now = Date.now();
    await this.runAsync(`UPDATE memory_entries SET active = 0, updatedAt = ? WHERE userId = ? AND key = ?`, [
      now,
      userId,
      canonicalKey,
    ]);
    await this.runAsync(`DELETE FROM memories WHERE userId = ? AND key = ?`, [userId, canonicalKey]);
  }

  async getConversations(userId: string, limit: number = 20): Promise<ConversationRecord[]> {
    return this.allAsync(
      `SELECT id, userId, createdAt, updatedAt FROM conversations
       WHERE userId = ?
       ORDER BY updatedAt DESC
       LIMIT ?`,
      [userId, limit]
    );
  }

  async deleteConversation(conversationId: string): Promise<void> {
    // Delete all messages in the conversation
    await this.runAsync(
      `DELETE FROM messages WHERE conversationId = ?`,
      [conversationId]
    );

    // Delete the conversation itself
    await this.runAsync(
      `DELETE FROM conversations WHERE id = ?`,
      [conversationId]
    );

    await this.runAsync(
      `DELETE FROM conversation_agent_state WHERE conversationId = ?`,
      [conversationId]
    );
  }

  // Skills configuration
  getSkillConfig(id: string): { enabled: boolean } | null {
    const row = this.db.getDb().get(
      `SELECT enabled FROM skills_config WHERE id = ?`,
      [id]
    );
    return row ? { enabled: Boolean(row.enabled) } : null;
  }

  saveSkillConfig(id: string, enabled: boolean): void {
    const now = Date.now();
    const existing = this.db.getDb().get(
      `SELECT id FROM skills_config WHERE id = ?`,
      [id]
    );

    if (existing) {
      this.db.getDb().run(
        `UPDATE skills_config SET enabled = ?, updatedAt = ? WHERE id = ?`,
        [enabled ? 1 : 0, now, id]
      );
    } else {
      this.db.getDb().run(
        `INSERT INTO skills_config (id, enabled, createdAt, updatedAt)
         VALUES (?, ?, ?, ?)`,
        [id, enabled ? 1 : 0, now, now]
      );
    }
  }

  getAllSkillConfigs(): { id: string; enabled: boolean }[] {
    const rows = this.db.getDb().all(
      `SELECT id, enabled FROM skills_config`,
      []
    );
    return (rows || []).map(row => ({
      id: row.id,
      enabled: Boolean(row.enabled),
    }));
  }

  // MCP Servers configuration
  saveMCPServer(config: MCPServerConfig): void {
    const now = Date.now();
    const db = this.db.getDb();

    console.log(`[MemoryService] Saving MCP server "${config.name}" (ID: ${config.id})`);

    // Check if server already exists
    const existing = db.get(
      `SELECT id FROM mcp_servers WHERE id = ?`,
      [config.id]
    );

    if (existing) {
      console.log(`[MemoryService] Updating existing MCP server "${config.name}"`);
      db.run(
        `UPDATE mcp_servers SET name = ?, description = ?, transport = ?, command = ?, args = ?, env = ?, url = ?, enabled = ?, updatedAt = ?
         WHERE id = ?`,
        [
          config.name,
          config.description || null,
          config.transport,
          config.command || null,
          config.args ? JSON.stringify(config.args) : null,
          config.env ? JSON.stringify(config.env) : null,
          config.url || null,
          config.enabled ? 1 : 0,
          now,
          config.id
        ]
      );
    } else {
      console.log(`[MemoryService] Inserting new MCP server "${config.name}"`);
      db.run(
        `INSERT INTO mcp_servers (id, name, description, transport, command, args, env, url, enabled, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          config.id,
          config.name,
          config.description || null,
          config.transport,
          config.command || null,
          config.args ? JSON.stringify(config.args) : null,
          config.env ? JSON.stringify(config.env) : null,
          config.url || null,
          config.enabled ? 1 : 0,
          config.createdAt,
          config.updatedAt
        ]
      );
    }

    console.log(`[MemoryService] MCP server "${config.name}" saved successfully`);
  }

  getMCPServers(): MCPServerConfig[] {
    const rows = this.db.getDb().all(
      `SELECT id, name, description, transport, command, args, env, url, enabled, createdAt, updatedAt FROM mcp_servers`,
      []
    );

    console.log(`[MemoryService] Retrieved ${rows ? rows.length : 0} MCP servers from database`);
    if (rows && rows.length > 0) {
      rows.forEach(row => {
        console.log(`[MemoryService] - Server: "${row.name}" (${row.transport}, enabled: ${row.enabled})`);
      });
    }

    return (rows || []).map(row => ({
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      transport: row.transport,
      command: row.command || undefined,
      args: row.args ? JSON.parse(row.args) : undefined,
      env: row.env ? JSON.parse(row.env) : undefined,
      url: row.url || undefined,
      enabled: Boolean(row.enabled),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  deleteMCPServer(id: string): void {
    this.db.getDb().run(
      `DELETE FROM mcp_servers WHERE id = ?`,
      [id]
    );
  }

  updateMCPServer(id: string, data: Partial<MCPServerConfig>): void {
    const now = Date.now();
    const db = this.db.getDb();

    // Get current server to preserve fields not being updated
    const current = db.get(
      `SELECT id, name, description, transport, command, args, env, url, enabled, createdAt, updatedAt FROM mcp_servers WHERE id = ?`,
      [id]
    );

    if (!current) {
      console.warn(`[MemoryService] MCP server "${id}" not found for update`);
      return;
    }

    // Merge with existing data
    const updated = {
      id: current.id,
      name: data.name ?? current.name,
      description: data.description ?? current.description,
      transport: data.transport ?? current.transport,
      command: data.command ?? current.command,
      args: data.args ?? (current.args ? JSON.parse(current.args) : undefined),
      env: data.env ?? (current.env ? JSON.parse(current.env) : undefined),
      url: data.url ?? current.url,
      enabled: data.enabled ?? Boolean(current.enabled),
      createdAt: current.createdAt,
      updatedAt: now,
    };

    db.run(
      `UPDATE mcp_servers SET name = ?, description = ?, transport = ?, command = ?, args = ?, env = ?, url = ?, enabled = ?, updatedAt = ?
       WHERE id = ?`,
      [
        updated.name,
        updated.description || null,
        updated.transport,
        updated.command || null,
        updated.args ? JSON.stringify(updated.args) : null,
        updated.env ? JSON.stringify(updated.env) : null,
        updated.url || null,
        updated.enabled ? 1 : 0,
        updated.updatedAt,
        id
      ]
    );
  }
}
