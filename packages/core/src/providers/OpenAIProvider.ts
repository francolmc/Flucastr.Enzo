import { CompletionRequest, CompletionResponse, LLMProvider, ToolCall } from './types.js';

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, model?: string, baseUrl = 'https://api.openai.com') {
    this.apiKey = apiKey;
    this.model = model || 'gpt-4o-mini';
    this.baseUrl = baseUrl;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    try {
      const body = {
        model: this.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens || 4096,
        ...(request.tools && request.tools.length > 0
          ? {
              tools: request.tools.map((tool) => ({
                type: 'function',
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
              tool_choice: 'auto',
            }
          : {}),
      };

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as any;
      const choice = data.choices?.[0];
      const message = choice?.message || {};
      const content = message.content || '';

      const toolCalls: ToolCall[] = [];
      if (Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) {
          const rawArgs = call?.function?.arguments;
          let parsedArgs: Record<string, any> = {};
          if (typeof rawArgs === 'string') {
            try {
              parsedArgs = JSON.parse(rawArgs);
            } catch {
              parsedArgs = {};
            }
          } else if (rawArgs && typeof rawArgs === 'object') {
            parsedArgs = rawArgs;
          }

          toolCalls.push({
            name: call?.function?.name || '',
            arguments: parsedArgs,
          });
        }
      }

      return {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          inputTokens: data.usage?.prompt_tokens || 0,
          outputTokens: data.usage?.completion_tokens || 0,
        },
        model: this.model,
        provider: this.name,
      };
    } catch (error) {
      console.error('OpenAIProvider.complete() error:', error);
      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  setModel(newModel: string): void {
    console.log(`[OpenAIProvider] Switching model from "${this.model}" to "${newModel}"`);
    this.model = newModel;
  }

  setApiKey(newApiKey: string): void {
    console.log('[OpenAIProvider] API key updated');
    this.apiKey = newApiKey;
  }
}
