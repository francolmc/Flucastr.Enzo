import { CompletionRequest, CompletionResponse, LLMProvider, ToolCall } from './types.js';
import { fetchWithRetry } from './retry.js';

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  model: string;
  private apiKey: string;
  private availableModelsCache: { models: string[]; expiresAt: number } | null = null;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model || 'claude-3-5-haiku-latest';
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    try {
      const systemMessages = request.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content.trim())
        .filter((text) => text.length > 0);

      const convertedMessages = request.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      if (convertedMessages.length === 0) {
        convertedMessages.push({ role: 'user', content: 'Hello' });
      }

      let resolvedModel = this.normalizeModel(this.model);
      let body = {
        model: resolvedModel,
        max_tokens: request.maxTokens || 4096,
        messages: convertedMessages,
        ...(systemMessages.length > 0 ? { system: systemMessages.join('\n\n') } : {}),
        ...(request.tools && request.tools.length > 0
          ? {
              tools: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters,
              })),
            }
          : {}),
      };

      let response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }, {
        providerName: this.name,
      });

      if (!response.ok) {
        let detail = `${response.status} ${response.statusText}`;
        let rawErrorBody: any = null;
        try {
          rawErrorBody = (await response.json()) as any;
          detail = rawErrorBody?.error?.message || rawErrorBody?.error?.type || detail;
        } catch {
          // Ignore body parsing errors and keep HTTP detail fallback.
        }

        if (this.isModelResolutionError(response.status, detail)) {
          const fallbackModel = await this.resolveBestModelForAccount(resolvedModel);
          if (fallbackModel && fallbackModel !== resolvedModel) {
            console.warn(
              `[AnthropicProvider] Model "${resolvedModel}" unavailable. Retrying with "${fallbackModel}".`
            );
            resolvedModel = fallbackModel;
            body = {
              ...body,
              model: resolvedModel,
            };
            response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
              },
              body: JSON.stringify(body),
            }, {
              providerName: this.name,
            });
          }
        }

        if (!response.ok) {
          let retryDetail = `${response.status} ${response.statusText}`;
          try {
            const retryBody = (await response.json()) as any;
            retryDetail = retryBody?.error?.message || retryBody?.error?.type || retryDetail;
          } catch {
            if (rawErrorBody?.error?.message) {
              retryDetail = rawErrorBody.error.message;
            }
          }
          throw new Error(`Anthropic API error: ${retryDetail}`);
        }
      }

      const data = await response.json() as any;

      let content = '';
      const toolCalls: ToolCall[] = [];

      if (data.content && Array.isArray(data.content)) {
        for (const block of data.content) {
          if (block.type === 'text') {
            content += block.text;
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              name: block.name,
              arguments: block.input,
            });
          }
        }
      }

      return {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          inputTokens: data.usage?.input_tokens || 0,
          outputTokens: data.usage?.output_tokens || 0,
        },
        model: resolvedModel,
        provider: this.name,
      };
    } catch (error) {
      console.error(`AnthropicProvider.complete() error:`, error);
      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  /**
   * Dynamically set the model for this provider
   * Allows switching models without restarting
   */
  setModel(newModel: string): void {
    console.log(`[AnthropicProvider] Switching model from "${this.model}" to "${newModel}"`);
    this.model = newModel;
  }

  /**
   * Update the API key for this provider
   */
  setApiKey(newApiKey: string): void {
    console.log('[AnthropicProvider] API key updated');
    this.apiKey = newApiKey;
  }

  private normalizeModel(model: string): string {
    const normalized = (model || '').trim();
    if (!normalized) {
      return 'claude-3-5-haiku-latest';
    }

    const aliases: Record<string, string> = {
      'claude-haiku': 'claude-3-haiku-20240307',
      'haiku': 'claude-3-haiku-20240307',
      'claude-sonnet': 'claude-3-5-sonnet-latest',
      'sonnet': 'claude-3-5-sonnet-latest',
      'claude-opus': 'claude-3-opus-latest',
      'opus': 'claude-3-opus-latest',
    };

    return aliases[normalized.toLowerCase()] || normalized;
  }

  private isModelResolutionError(statusCode: number, detail: string): boolean {
    if (statusCode !== 400 && statusCode !== 404) {
      return false;
    }
    return /model|not.*found|invalid/i.test(detail || '');
  }

  private async fetchAvailableModels(): Promise<string[]> {
    const now = Date.now();
    if (this.availableModelsCache && this.availableModelsCache.expiresAt > now) {
      return this.availableModelsCache.models;
    }

    try {
      const response = await fetchWithRetry('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
      }, {
        providerName: this.name,
      });
      if (!response.ok) {
        return [];
      }
      const data = (await response.json()) as any;
      const models = Array.isArray(data?.data)
        ? data.data
            .map((m: any) => m?.id)
            .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
        : [];

      this.availableModelsCache = {
        models,
        expiresAt: now + 5 * 60 * 1000,
      };
      return models;
    } catch {
      return [];
    }
  }

  private async resolveBestModelForAccount(desiredModel: string): Promise<string | null> {
    const availableModels = await this.fetchAvailableModels();
    if (availableModels.length === 0) {
      return null;
    }

    if (availableModels.includes(desiredModel)) {
      return desiredModel;
    }

    const desired = desiredModel.toLowerCase();
    const family = desired.includes('haiku')
      ? 'haiku'
      : desired.includes('sonnet')
      ? 'sonnet'
      : desired.includes('opus')
      ? 'opus'
      : null;

    if (family) {
      const familyMatch = availableModels.find((modelId) => modelId.toLowerCase().includes(family));
      if (familyMatch) {
        return familyMatch;
      }
    }

    return availableModels[0] || null;
  }
}
