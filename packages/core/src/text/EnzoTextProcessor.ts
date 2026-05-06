/**
 * EnzoTextProcessor - Concrete implementation of TextProcessor
 * 
 * This implementation uses the Orchestrator and other core services
 * to provide a unified text processing interface.
 */

import type {
  TextInput,
  TextOutput,
  TextProcessOptions,
  TextSource,
  TextProcessingStep,
} from './types.js';
import type {
  TextProcessor,
  TextProcessingStreamEvent,
  TextProcessorFeatures,
  TextProcessorConfig,
} from './TextProcessor.js';
import type { Orchestrator } from '../orchestrator/Orchestrator.js';
import type { MemoryService } from '../memory/MemoryService.js';
import type { ClassificationResult, OrchestratorInput } from '../orchestrator/types.js';

export interface EnzoTextProcessorDependencies {
  orchestrator: Orchestrator;
  memoryService: MemoryService;
}

export class EnzoTextProcessor implements TextProcessor {
  private orchestrator: Orchestrator;
  private memoryService: MemoryService;
  private config: TextProcessorConfig;

  constructor(deps: EnzoTextProcessorDependencies, config: TextProcessorConfig) {
    this.orchestrator = deps.orchestrator;
    this.memoryService = deps.memoryService;
    this.config = {
      enableTranslation: true,
      enableProgressTracking: true,
      defaultTimeoutMs: 90000,
      ...config,
    };
  }

  async process(input: TextInput, options?: TextProcessOptions): Promise<TextOutput> {
    const conversationId = input.conversationId || await this.getOrCreateConversationId(input.userId);
    
    const orchestratorInput: OrchestratorInput = {
      message: input.content,
      originalMessage: input.originalContent || input.content,
      conversationId,
      userId: input.userId,
      source: input.source,
      agentId: input.agentId,
      requestId: input.requestId,
      userLanguage: input.language || 'es',
      onProgress: options?.onProgress,
      classifiedLevel: undefined,
      ...input.metadata,
    };

    const startTime = Date.now();
    
    try {
      const response = await this.orchestrator.process(orchestratorInput);
      const durationMs = Date.now() - startTime;

      return {
        content: response.content,
        complexityUsed: response.complexityUsed,
        providerUsed: response.providerUsed,
        modelUsed: response.modelUsed,
        wasStreamed: false,
        durationMs,
        usage: response.usage,
        injectedSkills: response.injectedSkills,
      };
    } catch (error) {
      console.error('[EnzoTextProcessor] Error processing text:', error);
      throw error;
    }
  }

  async *processStream(
    input: TextInput,
    options?: TextProcessOptions
  ): AsyncGenerator<TextProcessingStreamEvent> {
    const conversationId = input.conversationId || await this.getOrCreateConversationId(input.userId);
    
    // Yield start event
    yield {
      type: 'start',
      data: { step: 'Processing started' },
    };

    const orchestratorInput: OrchestratorInput = {
      message: input.content,
      originalMessage: input.originalContent || input.content,
      conversationId,
      userId: input.userId,
      source: input.source,
      agentId: input.agentId,
      requestId: input.requestId,
      userLanguage: input.language || 'es',
      onProgress: (step) => {
        // Convert orchestrator step to text processing step
        if (options?.onProgress) {
          options.onProgress({
            type: step.type as TextProcessingStep['type'],
            iteration: step.iteration,
            description: step.action || step.output,
            modelUsed: step.modelUsed,
          });
        }
      },
      ...input.metadata,
    };

    const startTime = Date.now();

    try {
      // For now, we process and stream the response
      // Full streaming support would require changes to Orchestrator
      const response = await this.orchestrator.process(orchestratorInput);
      
      // Stream the content in chunks (simulate streaming)
      const content = response.content;
      const chunkSize = 100;
      
      for (let i = 0; i < content.length; i += chunkSize) {
        const chunk = content.slice(i, i + chunkSize);
        yield {
          type: 'chunk',
          data: { content: chunk },
        };
        // Small delay to simulate streaming
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const durationMs = Date.now() - startTime;

      // Yield complete event with final output
      yield {
        type: 'complete',
        data: {
          output: {
            content: response.content,
            complexityUsed: response.complexityUsed,
            providerUsed: response.providerUsed,
            modelUsed: response.modelUsed,
            wasStreamed: true,
            durationMs,
            usage: response.usage,
            injectedSkills: response.injectedSkills,
          },
        },
      };
    } catch (error) {
      console.error('[EnzoTextProcessor] Error in stream processing:', error);
      yield {
        type: 'error',
        data: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  async classify(
    input: Omit<TextInput, 'source'> & { source?: TextSource }
  ): Promise<ClassificationResult> {
    const source = input.source || this.config.defaultSource;
    
    return this.orchestrator.classifyDetailed(
      input.content,
      input.userId,
      input.conversationId,
      source
    );
  }

  getFeatures(): TextProcessorFeatures {
    return {
      supportsStreaming: true,
      supportsClassification: true,
      supportsTranslation: this.config.enableTranslation ?? true,
      supportedSources: ['telegram', 'web', 'cli', 'api', 'echo'],
      maxInputLength: 50000,
      supportsProgressTracking: this.config.enableProgressTracking ?? true,
    };
  }

  private async getOrCreateConversationId(userId: string): Promise<string> {
    // Check if there's an existing conversation or create new
    return this.memoryService.createConversation(userId);
  }
}
