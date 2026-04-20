import { CompletionRequest, CompletionResponse, LLMProvider, ToolCall } from './types.js';
import { fetchWithRetry } from './retry.js';

interface GeminiPart {
  text?: string;
  functionCall?: {
    name: string;
    args?: Record<string, any>;
  };
}

export class GeminiProvider implements LLMProvider {
  name = 'gemini';
  model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, model?: string, baseUrl = 'https://generativelanguage.googleapis.com/v1beta') {
    this.apiKey = apiKey;
    this.model = model || 'gemini-1.5-flash';
    this.baseUrl = baseUrl;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    try {
      const systemMessages = request.messages.filter((m) => m.role === 'system');
      const nonSystemMessages = request.messages.filter((m) => m.role !== 'system');

      const body = {
        contents: nonSystemMessages.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        ...(systemMessages.length > 0
          ? {
              systemInstruction: {
                role: 'system',
                parts: [{ text: systemMessages.map((m) => m.content).join('\n\n') }],
              },
            }
          : {}),
        ...(request.tools && request.tools.length > 0
          ? {
              tools: [
                {
                  functionDeclarations: request.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                  })),
                },
              ],
            }
          : {}),
        generationConfig: {
          temperature: request.temperature ?? 0.2,
          maxOutputTokens: request.maxTokens || 4096,
        },
      };

      const response = await fetchWithRetry(
        `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as any;
      const candidate = data.candidates?.[0];
      const parts = (candidate?.content?.parts || []) as GeminiPart[];

      let content = '';
      const toolCalls: ToolCall[] = [];

      for (const part of parts) {
        if (typeof part.text === 'string' && part.text.length > 0) {
          content += part.text;
        }
        if (part.functionCall?.name) {
          toolCalls.push({
            name: part.functionCall.name,
            arguments: part.functionCall.args || {},
          });
        }
      }

      return {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          inputTokens: data.usageMetadata?.promptTokenCount || 0,
          outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
        },
        model: this.model,
        provider: this.name,
      };
    } catch (error) {
      console.error('GeminiProvider.complete() error:', error);
      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  setModel(newModel: string): void {
    console.log(`[GeminiProvider] Switching model from "${this.model}" to "${newModel}"`);
    this.model = newModel;
  }

  setApiKey(newApiKey: string): void {
    console.log('[GeminiProvider] API key updated');
    this.apiKey = newApiKey;
  }
}
