import type { ConfigService } from '../config/ConfigService.js';
import type { LLMProvider } from '../providers/types.js';
import { OllamaProvider } from '../providers/OllamaProvider.js';
import { AnthropicProvider } from '../providers/AnthropicProvider.js';
import { OpenAIProvider } from '../providers/OpenAIProvider.js';
import { GeminiProvider } from '../providers/GeminiProvider.js';
import type { AgentConfig } from './types.js';
import { collectAnthropicApiKeys } from '../agents/anthropicDelegationUtils.js';

/**
 * Builds a concrete {@link LLMProvider} for a user agent preset (same rules as {@link Orchestrator} runtime).
 * Throws when configuration is missing or the provider fails {@link LLMProvider.isAvailable}.
 */
export async function instantiateProviderForAgent(
  configService: ConfigService | undefined,
  agent: AgentConfig,
  options?: { ollamaProviderCache?: Map<string, LLMProvider> }
): Promise<LLMProvider> {
  const providerName = (agent.provider || '').toLowerCase();
  const modelName = (agent.model || '').trim();
  if (!providerName || !modelName) {
    throw new Error('Agent missing provider or model');
  }

  const cacheKey = `${providerName}:${modelName}`;
  const cache = options?.ollamaProviderCache;
  if (providerName === 'ollama' && cache?.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  let provider: LLMProvider;
  if (providerName === 'ollama') {
    const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    provider = new OllamaProvider(ollamaBaseUrl, modelName);
  } else if (providerName === 'anthropic') {
    const keys: string[] =
      configService != null
        ? collectAnthropicApiKeys(configService)
        : (() => {
            const e = process.env.ANTHROPIC_API_KEY?.trim();
            return e ? [e] : [];
          })();
    const apiKey = keys[0]?.trim();
    if (!apiKey) {
      throw new Error('Anthropic API key is not configured');
    }
    provider = new AnthropicProvider(apiKey, modelName || process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5');
  } else if (providerName === 'openai') {
    const apiKey = configService?.getProviderApiKey('openai') || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key is not configured');
    }
    provider = new OpenAIProvider(apiKey, modelName || 'gpt-4o-mini');
  } else if (providerName === 'gemini') {
    const apiKey = configService?.getProviderApiKey('gemini') || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('Gemini API key is not configured');
    }
    provider = new GeminiProvider(apiKey, modelName || 'gemini-1.5-flash');
  } else {
    throw new Error(`Provider "${agent.provider}" is not supported`);
  }

  const isAvailable = await provider.isAvailable();
  if (!isAvailable) {
    throw new Error(`Provider "${providerName}" is not available`);
  }

  if (providerName === 'ollama' && cache) {
    cache.set(cacheKey, provider);
  }
  return provider;
}
