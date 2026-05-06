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
