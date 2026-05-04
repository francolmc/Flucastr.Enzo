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
  enzoNativeToolCalling: boolean;
  defaultUserLanguage: string;
  tz: string;
  telegramAllowedUsers: string;
  telegramAgentOwnerUserId: string;
  telegramAgentAutoroute: boolean;
  hasTelegramBotToken: boolean;
  hasTavilyApiKey: boolean;
  secretStoragePath: string;
  whisperUrl: string;
  whisperLanguage: string;
  ttsVoiceEs: string;
  ttsVoiceEn: string;
  voiceTriggers: string[];
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
  enzoNativeToolCalling?: boolean;
  defaultUserLanguage?: string;
  tz?: string;
  telegramAllowedUsers?: string;
  telegramAgentOwnerUserId?: string;
  telegramAgentAutoroute?: boolean;
  telegramBotToken?: string;
  tavilyApiKey?: string;
  whisperUrl?: string;
  whisperLanguage?: string;
  ttsVoiceEs?: string;
  ttsVoiceEn?: string;
  voiceTriggers?: string[];
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
  license?: string;
  compatibility?: string;
  'allowed-tools'?: string;
  metadata?: Record<string, string>;
}

export interface DailyRoutineNotification {
  time: string;
  enabled: boolean;
}

export interface DailyRoutineConfig {
  morningBriefing: DailyRoutineNotification;
  middayCheckin: DailyRoutineNotification;
  afternoonPrep: DailyRoutineNotification;
  eveningRecap: DailyRoutineNotification;
}

export interface DailyRoutineConfigUpdate {
  morningBriefing?: Partial<DailyRoutineNotification>;
  middayCheckin?: Partial<DailyRoutineNotification>;
  afternoonPrep?: Partial<DailyRoutineNotification>;
  eveningRecap?: Partial<DailyRoutineNotification>;
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

/** Memory row from GET /api/memory/:userId */
export interface UIMemory {
  id: string;
  userId: string;
  key: string;
  value: string;
  createdAt: number;
  updatedAt: number;
  /** extractor | tool | api | migrated — when persisted as memory_entries */
  source?: string;
  confidence?: number;
}

/** Timeline row from GET /api/memory/:userId/:key/history */
export interface UIMemoryHistoryItem extends UIMemory {
  isCurrent: boolean;
}

/** Row from GET/POST /api/calendar/:userId/events */
export interface CalendarEventDTO {
  id: string;
  userId: string;
  title: string;
  startAt: number;
  endAt: number | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface EchoResult {
  success: boolean;
  message?: string;
  notified?: boolean;
  error?: string;
}

export interface EchoTaskStatus {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  lastRun?: string;
  nextRun?: string;
  lastResult?: EchoResult;
  taskKind?: 'builtin' | 'declarative';
}

export interface EchoDiagnostics {
  processId: number;
  configPath: string;
  cronTimezoneConfigured?: string;
  processTimezoneLabel: string;
  utcOffsetMinutes: number;
  runtimeRole: string;
  echoTargetUserConfigured: boolean;
  orchestratorBoundForDeclarative: boolean;
  duplicateEchoWarning?: string;
}

export interface EchoEngineStatus {
  running: boolean;
  tasks: EchoTaskStatus[];
  diagnostics: EchoDiagnostics;
}

export type EchoComplexityLevelOption = '' | 'SIMPLE' | 'MODERATE' | 'COMPLEX' | 'AGENT';

export interface DeclarativeOrchestratorPayloadDTO {
  message: string;
  userId?: string;
  conversationId?: string;
  agentId?: string;
  userLanguage?: string;
  classifiedLevel?: 'SIMPLE' | 'MODERATE' | 'COMPLEX' | 'AGENT';
  maxRetries?: number;
  notifyOnResult?: boolean;
  notificationPreviewChars?: number;
}

export interface DeclarativeEchoJobDTO {
  id: string;
  name?: string;
  kind: 'orchestrator_message';
  enabled?: boolean;
  schedule: string;
  payload: DeclarativeOrchestratorPayloadDTO;
}

export interface EchoDeclarativeJobsResponse {
  jobs: DeclarativeEchoJobDTO[];
  cronTimezone?: string;
  invalidDeclarativeEntries: { index: number; summary: string }[];
}

export type NotificationPriority = 'URGENT' | 'NORMAL' | 'LOW';
export type NotificationChannel = 'telegram' | 'log';

export interface Notification {
  message: string;
  priority: NotificationPriority;
  sentAt: string;
  channel: NotificationChannel;
}

export interface Project {
  name: string;
  lastActivity: string;
  pendingItems: string[];
}

/** Email account as returned by GET /api/email/accounts */
export interface EmailAccountConfigDTO {
  id: string;
  label: string;
  /** `imap` legacy; optional for OAuth-only rows. */
  provider: 'imap' | 'google' | 'microsoft';
  imap?: {
    host: string;
    port: number;
    user: string;
  };
  address?: string;
  microsoftTenantId?: string;
  enabled: boolean;
  hasPassword: boolean;
  /** True when OAuth refresh token stored (Gmail/Microsoft). */
  hasOAuth: boolean;
}

/** GET /api/email/oauth-apps */
export interface EmailOAuthAppsStatusDTO {
  google: {
    persistedClientId: boolean;
    persistedHasClientSecret: boolean;
    envClientId: boolean;
    envClientSecret: boolean;
  };
  microsoft: {
    persistedClientId: boolean;
    persistedHasClientSecret: boolean;
    envClientId: boolean;
    envClientSecret: boolean;
  };
  /** IDs guardados en config (la UI los edita; env tiene prioridad al conectar si está definido). */
  googleClientId: string | null;
  microsoftClientId: string | null;
  /** Base que usó la API para armar redirect_uri (sirve para copiarla en Google/Azure). */
  oauthRedirectBase?: string;
  googleOAuthRedirectUri?: string;
  microsoftOAuthRedirectUri?: string;
  /** true si la base vino de ENZO_PUBLIC_API_BASE_URL. */
  oauthOriginUsesPublicEnvVar?: boolean;
}

/** Email preview row (API GET /api/email/recent) */
export interface EmailMessageDTO {
  id: string;
  subject: string;
  from: string;
  to: string[];
  date: string;
  preview: string;
  hasAttachments: boolean;
  folder: string;
  accountId?: string;
  accountLabel?: string;
}
