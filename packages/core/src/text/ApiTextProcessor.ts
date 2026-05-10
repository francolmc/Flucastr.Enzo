/**
 * ApiTextProcessor - TextProcessor implementation for API consumption
 * 
 * This implementation is designed to be used by the API layer,
 * providing a clean interface between HTTP routes and the core.
 */

import type {
  TextInput,
  TextOutput,
  TextProcessOptions,
  TextSource,
} from './types.js';
import type {
  TextProcessor,
  TextProcessingStreamEvent,
  TextProcessorFeatures,
} from './TextProcessor.js';
import type { EnzoTextProcessor } from './EnzoTextProcessor.js';
import type { ClassificationResult } from '../orchestrator/types.js';

export interface ApiTextProcessorConfig {
  /** The underlying EnzoTextProcessor to delegate to */
  processor: EnzoTextProcessor;
  /** Default source if not specified in input */
  defaultSource: TextSource;
}

/**
 * ApiTextProcessor wraps an EnzoTextProcessor and adds API-specific
 * functionality like request validation and response formatting.
 */
export class ApiTextProcessor implements TextProcessor {
  private processor: EnzoTextProcessor;
  private defaultSource: TextSource;

  constructor(config: ApiTextProcessorConfig) {
    this.processor = config.processor;
    this.defaultSource = config.defaultSource;
  }

  async process(input: TextInput, options?: TextProcessOptions): Promise<TextOutput> {
    // Ensure source is set
    const enrichedInput: TextInput = {
      ...input,
      source: input.source || this.defaultSource,
    };

    // Validate input
    this.validateInput(enrichedInput);

    return this.processor.process(enrichedInput, options);
  }

  async *processStream(
    input: TextInput,
    options?: TextProcessOptions
  ): AsyncGenerator<TextProcessingStreamEvent> {
    const enrichedInput: TextInput = {
      ...input,
      source: input.source || this.defaultSource,
    };

    this.validateInput(enrichedInput);

    yield* this.processor.processStream(enrichedInput, options);
  }

  async classify(
    input: Omit<TextInput, 'source'> & { source?: TextSource }
  ): Promise<ClassificationResult> {
    const enrichedInput = {
      ...input,
      source: input.source || this.defaultSource,
    };

    if (!enrichedInput.content?.trim()) {
      throw new Error('Content is required for classification');
    }

    if (!enrichedInput.userId) {
      throw new Error('UserId is required for classification');
    }

    return this.processor.classify(enrichedInput);
  }

  getFeatures(): TextProcessorFeatures {
    return this.processor.getFeatures();
  }

  private validateInput(input: TextInput): void {
    if (!input.content?.trim()) {
      throw new Error('Content is required');
    }

    if (!input.userId) {
      throw new Error('UserId is required');
    }

    if (!input.source) {
      throw new Error('Source is required');
    }
  }
}
