export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface CompletionRequest {
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  tools?: Tool[];
}

export interface CompletionResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  model: string;
  provider: string;
}

export interface LLMProvider {
  name: string;
  model: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  isAvailable(): Promise<boolean>;
}
