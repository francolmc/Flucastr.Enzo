/**
 * Text processing module for Enzo
 * 
 * Provides a generic text mode interface for communicating with the core.
 * Works with any client: Telegram, Web, CLI, or API.
 */

// Types
export type {
  TextInput,
  TextOutput,
  TextProcessOptions,
  TextSource,
  TextClassificationResult,
  TextProcessingStep,
} from './types.js';

// Interfaces
export type {
  TextProcessor,
  TextProcessingStreamEvent,
  TextProcessorFeatures,
  TextProcessorConfig,
} from './TextProcessor.js';

// Implementations
export { EnzoTextProcessor } from './EnzoTextProcessor.js';
export type { EnzoTextProcessorDependencies } from './EnzoTextProcessor.js';

export { ApiTextProcessor } from './ApiTextProcessor.js';
export type { ApiTextProcessorConfig } from './ApiTextProcessor.js';
