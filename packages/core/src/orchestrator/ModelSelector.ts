import { LLMProvider } from '../providers/types.js';
import { OllamaProvider } from '../providers/OllamaProvider.js';
import { AnthropicProvider } from '../providers/AnthropicProvider.js';
import { ComplexityLevel } from './types.js';

export class ModelSelector {
  private ollamaProvider: OllamaProvider;
  private anthropicProvider?: AnthropicProvider;
  private anthropicAvailable: boolean;

  constructor(ollamaProvider: OllamaProvider, anthropicProvider?: AnthropicProvider) {
    this.ollamaProvider = ollamaProvider;
    this.anthropicProvider = anthropicProvider;
    this.anthropicAvailable = !!anthropicProvider;
  }

  async select(level: ComplexityLevel): Promise<LLMProvider> {
    switch (level) {
      case ComplexityLevel.SIMPLE:
        return this.ollamaProvider;

      case ComplexityLevel.MODERATE:
        return this.ollamaProvider;

      case ComplexityLevel.COMPLEX:
        if (this.anthropicAvailable && this.anthropicProvider) {
          const isAvailable = await this.anthropicProvider.isAvailable();
          if (isAvailable) {
            return this.anthropicProvider;
          }
        }
        return this.ollamaProvider;

      case ComplexityLevel.AGENT:
        // For now, default to Ollama. In Phase 4, this will check agent configuration
        return this.ollamaProvider;

      default:
        return this.ollamaProvider;
    }
  }
}
