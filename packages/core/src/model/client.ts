import { ConfigService } from '../config.js';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface ModelClient {
  complete(messages: Message[], options?: CompletionOptions): Promise<string>;
}

export function createModelClient(config: ConfigService): ModelClient {
  const baseUrl = config.ollamaBaseUrl;
  const model = config.primaryModel;

  return {
    async complete(messages, options = {}) {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          options: {
            temperature: options.temperature ?? 0.3,
            num_predict: options.maxTokens ?? 1024,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Model error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { message: { content: string } };
      return data.message.content.trim();
    },
  };
}