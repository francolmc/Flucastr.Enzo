/** How a profile memory row entered the store (SQLite memory_entries.source). */
export type MemoryEntrySource = 'extractor' | 'tool' | 'api' | 'migrated';

export interface Memory {
  id: string;
  userId: string;
  key: string;
  value: string;
  createdAt: number;
  updatedAt: number;
  /** Present when backed by memory_entries; omitted for legacy rows. */
  source?: MemoryEntrySource;
  confidence?: number;
}

export type MemoryLessonSource = 'tool_failure' | 'user_correction';

/** Durable correction pattern after failures (memory_lessons). */
export interface MemoryLesson {
  id: string;
  userId: string;
  situation: string;
  avoid: string;
  prefer: string;
  source: MemoryLessonSource;
  confidence: number;
  conversationId?: string;
  requestId?: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryHistoryItem extends Memory {
  isCurrent: boolean;
}

export interface SaveMemoryLessonInput {
  userId: string;
  situation: string;
  avoid: string;
  prefer: string;
  source: MemoryLessonSource;
  confidence: number;
  conversationId?: string;
  requestId?: string;
}

export interface RememberOptions {
  source?: MemoryEntrySource;
  confidence?: number;
}

export interface UsageStat {
  id: string;
  requestId?: string;
  conversationId: string;
  userId: string;
  source: 'web' | 'telegram' | 'unknown';
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
  stageMetrics?: Record<string, {
    count: number;
    errorCount: number;
    totalDurationMs: number;
    maxDurationMs: number;
  }>;
  /** Continuity / context window diagnostics (not a pipeline stage). */
  continuity?: {
    recentTurns: number;
    droppedTurns: number;
    summaryUsed: boolean;
    tokensEstimated: number;
    flowKind: string;
    flowConfidence: number;
  };
  toolsUsed: string[];
  complexityLevel: string;
  createdAt: number;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  modelUsed?: string;
  complexityUsed?: string;
  durationMs?: number;
  injectedSkills?: InjectedSkillUsage[];
  createdAt: number;
}

export interface InjectedSkillUsage {
  id: string;
  name: string;
  relevanceScore: number;
}

export interface AssistantMessageMetadata {
  modelUsed?: string;
  complexityUsed?: string;
  durationMs?: number;
  injectedSkills?: InjectedSkillUsage[];
}

export interface ConversationRecord {
  id: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
}

/** Rolling summary of older turns for long threads (see ConversationSummarizer). */
export interface ConversationSummaryRecord {
  conversationId: string;
  summary: string;
  upToMessageId: string;
  upToCreatedAt: number;
  topicHint?: string;
  updatedAt: number;
}

export interface AgentRecord {
  id: string;
  userId: string;
  name: string;
  description?: string;
  provider: string;
  model: string;
  systemPrompt?: string;
  assistantNameOverride?: string;
  personaOverride?: string;
  toneOverride?: string;
  createdAt: number;
  updatedAt: number;
}
