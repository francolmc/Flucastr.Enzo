/**
 * TextProcessor - Generic interface for text mode communication
 * 
 * Provides a clean text-mode interface for any client to communicate with Enzo.
 * Abstracts away the complexity of different input sources (Telegram, Web, CLI).
 */

import type {
  TextInput,
  TextOutput,
  TextProcessOptions,
  TextSource,
} from './types.js';
import type { ClassificationResult } from '../orchestrator/types.js';

export interface TextProcessor {
  /**
   * Process text input and return a response
   * 
   * @param input - The text input to process
   * @param options - Processing options
   * @returns Promise with the text output
   */
  process(input: TextInput, options?: TextProcessOptions): Promise<TextOutput>;

  /**
   * Process text input with streaming response
   * 
   * @param input - The text input to process
   * @param options - Processing options (stream must be true)
   * @returns Async generator yielding text chunks/progress
   */
  processStream(
    input: TextInput,
    options?: TextProcessOptions
  ): AsyncGenerator<TextProcessingStreamEvent>;

  /**
   * Classify text input to determine complexity
   * 
   * @param input - The text input to classify
   * @returns Promise with classification result
   */
  classify(input: Omit<TextInput, 'source'> & { source?: TextSource }): Promise<ClassificationResult>;

  /**
   * Get supported features for this processor
   */
  getFeatures(): TextProcessorFeatures;
}

export interface TextProcessingStreamEvent {
  /** Event type */
  type: 'start' | 'progress' | 'chunk' | 'complete' | 'error';
  /** Event data */
  data: {
    /** Content chunk (for 'chunk' events) */
    content?: string;
    /** Progress information (for 'progress' events) */
    step?: string;
    /** Error message (for 'error' events) */
    error?: string;
    /** Final output (for 'complete' events) */
    output?: TextOutput;
  };
}

export interface TextProcessorFeatures {
  /** Whether streaming is supported */
  supportsStreaming: boolean;
  /** Whether classification is supported */
  supportsClassification: boolean;
  /** Whether translation is supported */
  supportsTranslation: boolean;
  /** Supported text sources */
  supportedSources: TextSource[];
  /** Maximum input length in characters */
  maxInputLength: number;
  /** Whether progress tracking is supported */
  supportsProgressTracking: boolean;
}

/**
 * Configuration for creating a TextProcessor
 */
export interface TextProcessorConfig {
  /** Default source identifier */
  defaultSource: TextSource;
  /** Whether to enable automatic translation */
  enableTranslation?: boolean;
  /** Whether to enable progress tracking */
  enableProgressTracking?: boolean;
  /** Timeout for processing (ms) */
  defaultTimeoutMs?: number;
}
