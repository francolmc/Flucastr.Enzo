/**
 * Text processing types for Enzo
 * 
 * Defines interfaces for generic text mode communication with the core.
 * This allows any client (Telegram, Web, CLI, API) to process text input
 * in a unified way.
 */

import type { ClassificationResult, ComplexityLevel } from '../orchestrator/types.js';

export type TextSource = 'telegram' | 'web' | 'cli' | 'api' | 'echo' | 'unknown';

export interface TextInput {
  /** The text content to process */
  content: string;
  /** Original content before any translation/normalization */
  originalContent?: string;
  /** User identifier */
  userId: string;
  /** Conversation identifier */
  conversationId?: string;
  /** Source of the text (telegram, web, cli, etc.) */
  source: TextSource;
  /** Detected or preferred language (e.g., 'es', 'en') */
  language?: string;
  /** Whether the input was translated */
  wasTranslated?: boolean;
  /** Optional agent ID to use for processing */
  agentId?: string;
  /** Request identifier for tracking */
  requestId?: string;
  /** Additional metadata from the source */
  metadata?: Record<string, any>;
}

export interface TextOutput {
  /** The processed response content */
  content: string;
  /** Complexity level used for processing */
  complexityUsed: ComplexityLevel;
  /** Provider that generated the response */
  providerUsed: string;
  /** Model used for the response */
  modelUsed: string;
  /** Whether streaming was used */
  wasStreamed?: boolean;
  /** Processing duration in milliseconds */
  durationMs: number;
  /** Token usage information */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd?: number;
  };
  /** Skills that were injected into the context */
  injectedSkills?: Array<{
    id: string;
    name: string;
    relevanceScore: number;
  }>;
  /** Classification result */
  classification?: ClassificationResult;
}

export interface TextProcessOptions {
  /** Whether to use streaming for the response */
  stream?: boolean;
  /** Callback for progress updates during streaming */
  onProgress?: (step: TextProcessingStep) => void;
  /** Maximum time to wait for response (ms) */
  timeoutMs?: number;
  /** Additional context for processing */
  context?: {
    /** Previous messages in the conversation */
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    /** System instructions to prepend */
    systemPrompt?: string;
    /** Any additional context variables */
    [key: string]: any;
  };
}

export interface TextProcessingStep {
  /** Step type */
  type: 'think' | 'act' | 'observe' | 'synthesize' | 'verify' | 'start' | 'chunk' | 'done';
  /** Step iteration number */
  iteration?: number;
  /** Description of what's happening */
  description?: string;
  /** Partial content (for streaming) */
  content?: string;
  /** Model being used */
  modelUsed?: string;
  /** Duration so far */
  durationMs?: number;
}

export interface TextClassificationResult extends ClassificationResult {
  /** Source that was classified */
  source: TextSource;
}
