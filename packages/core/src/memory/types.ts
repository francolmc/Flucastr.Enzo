export interface Memory {
  id: string;
  userId: string;
  key: string;
  value: string;
  createdAt: number;
  updatedAt: number;
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
