export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
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

export interface StreamEvent {
  type: 'start' | 'progress' | 'chunk' | 'done' | 'error';
  data: Record<string, any>;
}

export interface ConversationItem {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConfigData {
  primaryModel: string;
  availableProviders: string[];
  ollamaModels: string[];
  assistantProfile?: AssistantProfile;
  userProfile?: UserProfile;
  systemConfig?: SystemConfigView;
}

export interface SystemConfigView {
  ollamaBaseUrl: string;
  anthropicModel: string;
  port: string;
  uiPort: string;
  dbPath: string;
  enzoWorkspacePath: string;
  enzoSkillsPath: string;
  enzoDebug: boolean;
  enzoSkillsFallbackRelevanceThreshold: number;
  mcpAutoConnect: boolean;
  defaultUserLanguage: string;
  tz: string;
  telegramAllowedUsers: string;
  telegramAgentOwnerUserId: string;
  telegramAgentAutoroute: boolean;
  hasTelegramBotToken: boolean;
  hasTavilyApiKey: boolean;
  secretStoragePath: string;
}

export interface SystemConfigUpdatePayload {
  ollamaBaseUrl?: string;
  anthropicModel?: string;
  port?: string;
  uiPort?: string;
  dbPath?: string;
  enzoWorkspacePath?: string;
  enzoSkillsPath?: string;
  enzoDebug?: boolean;
  enzoSkillsFallbackRelevanceThreshold?: number;
  mcpAutoConnect?: boolean;
  defaultUserLanguage?: string;
  tz?: string;
  telegramAllowedUsers?: string;
  telegramAgentOwnerUserId?: string;
  telegramAgentAutoroute?: boolean;
  telegramBotToken?: string;
  tavilyApiKey?: string;
}

export interface AssistantProfile {
  name: string;
  persona?: string;
  tone?: string;
  styleGuidelines?: string;
}

export interface UserProfile {
  displayName?: string;
  importantInfo?: string;
  preferences?: string;
  locale?: string;
  timezone?: string;
}

export interface ProfilesConfigData {
  assistantProfile: AssistantProfile;
  userProfile: UserProfile;
}

export interface AgentConfig {
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

export interface SkillMetadata {
  name: string;
  description: string;
  version?: string;
  author?: string;
}

export interface SkillRecord {
  id: string;
  metadata: SkillMetadata;
  content: string;
  path: string;
  enabled: boolean;
}

export interface SkillsResponse {
  skills: SkillRecord[];
}

export interface ProviderStats {
  provider: string;
  count: number;
  tokens: number;
  costUsd: number;
}

export interface SourceStats {
  source: string;
  count: number;
  tokens: number;
  costUsd: number;
}

export interface ModelStats {
  model: string;
  provider: string;
  count: number;
  tokens: number;
  costUsd: number;
}

export interface ComplexityStats {
  level: string;
  count: number;
}

export interface ToolUsageStats {
  tool: string;
  count: number;
}

export interface StatsData {
  totalMessages: number;
  totalTokens: number;
  totalCostUsd: number;
  byProvider: ProviderStats[];
  bySource: SourceStats[];
  byModel: ModelStats[];
  byComplexity: ComplexityStats[];
  byTool: ToolUsageStats[];
  byDay: Array<{ date: string; count: number; tokens: number; costUsd: number }>;
  averageDurationMs: number;
}
