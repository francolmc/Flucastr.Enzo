import type { ConfigService } from '../config/ConfigService.js';
import type { LLMProvider } from '../providers/types.js';
import { OllamaProvider } from '../providers/OllamaProvider.js';
import { AnthropicProvider } from '../providers/AnthropicProvider.js';
import { OpenAIProvider } from '../providers/OpenAIProvider.js';

export async function instantiateProviderForModel(
  providerName: string,
  modelName: string,
  configService?: ConfigService
): Promise<LLMProvider> {
  switch (providerName) {
    case 'ollama': {
      const baseUrl = configService?.getSystemConfig().ollamaBaseUrl ?? 'http://localhost:11434';
      return new OllamaProvider(baseUrl, modelName);
    }
    case 'anthropic': {
      const apiKey = configService?.getProviderApiKey('anthropic') ?? '';
      return new AnthropicProvider(apiKey, modelName);
    }
    case 'openai': {
      const apiKey = configService?.getProviderApiKey('openai') ?? '';
      return new OpenAIProvider(apiKey, modelName);
    }
    default:
      throw new Error(`Provider "${providerName}" not supported in instantiateProviderForModel`);
  }
}