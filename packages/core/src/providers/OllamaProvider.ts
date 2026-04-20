import { CompletionRequest, CompletionResponse, LLMProvider, ToolCall } from './types.js';
import { fetchWithRetry } from './retry.js';

export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  model: string;
  private baseUrl: string;

  constructor(baseUrl: string, model: string) {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    try {
      const body = {
        model: this.model,
        messages: request.messages,
        stream: false,
        ...(request.tools && { tools: request.tools }),
      };

      const response = await fetchWithRetry(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;

      const toolCalls: ToolCall[] = [];
      if (data.message?.tool_calls) {
        for (const toolCall of data.message.tool_calls) {
          toolCalls.push({
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
          });
        }
      }

      return {
        content: data.message?.content || '',
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          inputTokens: data.prompt_eval_count || 0,
          outputTokens: data.eval_count || 0,
        },
        model: this.model,
        provider: this.name,
      };
    } catch (error) {
      console.error(`OllamaProvider.complete() error:`, error);
      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch (error) {
      console.error(`OllamaProvider.isAvailable() error:`, error);
      return false;
    }
  }

  /**
   * Dynamically set the model for this provider
   * Allows switching models without restarting
   */
  setModel(newModel: string): void {
    console.log(`[OllamaProvider] Switching model from "${this.model}" to "${newModel}"`);
    this.model = newModel;
  }

  /**
   * Dynamically set the base URL for this provider
   * Allows switching Ollama host without restarting
   */
  setBaseUrl(newBaseUrl: string): void {
    if (!newBaseUrl || !newBaseUrl.trim()) {
      return;
    }
    if (this.baseUrl !== newBaseUrl) {
      console.log(`[OllamaProvider] Switching base URL from "${this.baseUrl}" to "${newBaseUrl}"`);
      this.baseUrl = newBaseUrl;
    }
  }
}
