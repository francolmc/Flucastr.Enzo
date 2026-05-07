/**
 * Types for Enzo SDK - Shared between API and clients
 */

import type { Buffer } from 'buffer';

export interface ChatOptions {
  conversationId?: string;
  userId: string;
  agentId?: string;
  userLanguage?: string;
  source?: 'telegram' | 'web' | 'cli' | 'api';
}

export interface ChatResponse {
  content: string;
  conversationId: string;
  requestId: string;
  complexityUsed: string;
  providerUsed: string;
  modelUsed: string;
  injectedSkills: InjectedSkillUsage[];
  durationMs: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd?: number;
  };
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

export interface ClassificationResult {
  level: 'SIMPLE' | 'MODERATE' | 'COMPLEX' | 'AGENT';
  reason: string;
  suggestedTool?: 'web_search';
  prefersHostTools?: boolean;
  suppressSimpleModerateFastPath?: boolean;
  delegationHint?: {
    agentId?: string;
    reason: string;
  };
  classifierBranch?: string;
}

export interface ClassificationContext {
  conversationId: string;
  userId: string;
  source?: 'telegram' | 'web' | 'cli' | 'api';
}

export interface Command {
  name: string;
  description: string;
  category: 'chat' | 'memory' | 'agent' | 'system';
  requiresAdmin: boolean;
}

export interface CommandResult {
  success: boolean;
  message: string;
  data?: Record<string, any>;
}

export interface FileUploadResult {
  fileId: string;
  url?: string;
  localPath?: string;
  sizeBytes: number;
  mimeType: string;
}

export interface TranscriptionResult {
  success: boolean;
  text?: string;
  confidence?: number;
  error?: string;
}

export interface SynthesisResult {
  success: boolean;
  audioBuffer?: Buffer;
  error?: string;
}

export interface Memory {
  key: string;
  value: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProgressStep {
  iteration: number;
  type: 'think' | 'act' | 'observe' | 'synthesize' | 'verify';
  requestId?: string;
  action?: string;
  target?: string;
  input?: string;
  output?: string;
  durationMs?: number;
  status?: 'ok' | 'error';
  modelUsed: string;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

// ========== User Preferences ==========

export interface UserPreferencesVerbosity {
  explainClassification: boolean;
  showSkillsConsidered: boolean;
  showMCPsConsidered: boolean;
  announceDecomposition: boolean;
}

export interface UserPreferencesConfirmations {
  beforeDelegation: boolean;
  beforeComplexDecomposition: boolean;
  beforeMCPCall: boolean;
}

export interface UserPreferencesExecution {
  preferSkillsOverMCPs: boolean;
  maxIterations: number;
  enableLearning: boolean;
}

export interface UserPreferences {
  verbosity: UserPreferencesVerbosity;
  requireConfirmation: UserPreferencesConfirmations;
  execution: UserPreferencesExecution;
}

export interface UserPreferencesResponse {
  userId: string;
  preferences: UserPreferences;
}

export interface ProfileInfo {
  name: string;
  description: string;
}

export interface ProfilesResponse {
  profiles: ProfileInfo[];
}

// ========== Decision Logs ==========

export type DecisionPhase =
  | 'classification'
  | 'skill_resolution'
  | 'mcp_resolution'
  | 'decomposition'
  | 'execution'
  | 'synthesis'
  | 'delegation';

export interface DecisionLogEntry {
  phase: DecisionPhase;
  decision: Record<string, unknown>;
  reasoning: string;
  alternatives?: string[];
  timestamp: string;
}

export interface DecisionsResponse {
  requestId: string;
  count: number;
  decisions: DecisionLogEntry[];
}

export interface DecisionSummary {
  requestId: string;
  userId: string;
  timestamp: string;
  phases: {
    classification?: {
      level: string;
      reason: string;
      hints: Record<string, unknown>;
    };
    skills?: {
      considered: string[];
      selected: string[];
    };
    mcps?: {
      considered: string[];
      selected: string[];
    };
    decomposition?: {
      steps: number;
      tools: string[];
    };
    execution?: {
      iterations: number;
      toolsUsed: string[];
      delegation?: {
        agent: string;
        reason: string;
      };
    };
  };
}

export interface UserDecisionsResponse {
  userId: string;
  count: number;
  decisions: Array<{
    requestId: string;
    phase: DecisionPhase;
    decision: Record<string, unknown>;
    reasoning: string;
    timestamp: string;
  }>;
}

export interface DecisionsStats {
  totalRequests: number;
  totalDecisions: number;
  phaseDistribution: Record<string, number>;
}

// ========== Lessons / Learning ==========

export interface LessonStrategy {
  classification: string;
  skillsUsed: string[];
  mcpsUsed: string[];
  decompositionSteps?: string[];
  toolsUsed?: string[];
}

export interface LessonSummary {
  id: string;
  taskPattern: string;
  successCount: number;
  failureCount: number;
  lastUsedAt: string;
}

export interface LessonDetails extends LessonSummary {
  successfulStrategy: LessonStrategy;
  failedAttempts?: Array<{
    reason: string;
    whatWentWrong: string;
  }>;
  createdAt: string;
}

export interface UserLessonsResponse {
  userId: string;
  count: number;
  lessons: LessonSummary[];
}

export interface TaskLessonsResponse {
  userId: string;
  taskPattern: string;
  count: number;
  lessons: any[];
}

export interface LessonStats {
  totalLessons: number;
  totalUsers: number;
  averageSuccessRate: number;
  topPatterns: Array<{ pattern: string; successCount: number }>;
}
