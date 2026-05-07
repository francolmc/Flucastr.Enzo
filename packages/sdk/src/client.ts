/**
 * Enzo API Client - SDK para consumir la API de Enzo
 */

/// <reference lib="dom" />

import { Buffer } from 'buffer';
import type {
  ChatOptions,
  ChatResponse,
  StreamEvent,
  ClassificationResult,
  ClassificationContext,
  Command,
  CommandResult,
  FileUploadResult,
  TranscriptionResult,
  SynthesisResult,
  Memory,
  ApiError,
  UserPreferences,
  UserPreferencesResponse,
  ProfilesResponse,
  DecisionsResponse,
  DecisionSummary,
  UserDecisionsResponse,
  DecisionsStats,
  LessonSummary,
  LessonDetails,
  UserLessonsResponse,
  TaskLessonsResponse,
  LessonStats,
} from './types.js';

export interface ClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
}

export class EnzoApiClient {
  private baseUrl: string;
  private apiKey?: string;
  private timeout: number;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 90000;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    if (this.apiKey) {
      requestHeaders['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as ApiError;
      throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  // ========== CHAT ==========
  chat = {
    send: async (message: string, options: ChatOptions): Promise<ChatResponse> => {
      return this.request<ChatResponse>('POST', '/api/chat', {
        message,
        ...options,
      });
    },

    stream: async function* (
      this: EnzoApiClient,
      message: string,
      options: ChatOptions
    ): AsyncGenerator<StreamEvent> {
      const url = `${this.baseUrl}/api/chat/stream`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message, ...options }),
      });

      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as ApiError;
        throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return;
            try {
              yield JSON.parse(data) as StreamEvent;
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    }.bind(this),

    classify: async (
      message: string,
      context: ClassificationContext
    ): Promise<ClassificationResult> => {
      return this.request<ClassificationResult>('POST', '/api/chat/classify', {
        message,
        ...context,
      });
    },

    getHistory: async (conversationId: string): Promise<{ messages: unknown[] }> => {
      return this.request<{ messages: unknown[] }>('GET', `/api/chat/${conversationId}/history`);
    },

    getConversations: async (userId: string): Promise<{ conversations: unknown[] }> => {
      return this.request<{ conversations: unknown[] }>('GET', `/api/chat/conversations/${userId}`);
    },

    deleteConversation: async (conversationId: string): Promise<{ success: boolean }> => {
      return this.request<{ success: boolean }>('DELETE', `/api/chat/${conversationId}`);
    },
  };

  // ========== COMMANDS ==========
  commands = {
    list: async (): Promise<Command[]> => {
      const response = await this.request<{ commands: Command[] }>('GET', '/api/commands');
      return response.commands;
    },

    execute: async (name: string, args?: string[], userId?: string): Promise<CommandResult> => {
      return this.request<CommandResult>('POST', `/api/commands/${name}/execute`, {
        args,
        userId,
      });
    },
  };

  // ========== FILES ==========
  files = {
    upload: async (
      buffer: Buffer,
      filename: string,
      mimeType?: string
    ): Promise<FileUploadResult> => {
      const formData = new FormData();
      // Node Buffer to Blob: use the underlying ArrayBuffer
      const blob = new Blob([buffer as unknown as BlobPart], { type: mimeType || 'application/octet-stream' });
      formData.append('file', blob, filename);

      const url = `${this.baseUrl}/api/files/upload`;
      const headers: Record<string, string> = {};

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as ApiError;
        throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json() as Promise<FileUploadResult>;
    },
  };

  // ========== VOICE ==========
  voice = {
    transcribe: async (audioBuffer: Buffer, mimeType: string): Promise<TranscriptionResult> => {
      // Convert Buffer to base64 for JSON transport
      const base64 = audioBuffer.toString('base64');
      return this.request<TranscriptionResult>('POST', '/api/voice/transcribe', {
        audioBase64: base64,
        mimeType,
      });
    },

    synthesize: async (text: string, language: string): Promise<SynthesisResult> => {
      const response = await this.request<{ success: boolean; audioBase64?: string; error?: string }>(
        'POST',
        '/api/voice/synthesize',
        {
          text,
          language,
        }
      );

      return {
        success: response.success,
        audioBuffer: response.audioBase64 ? Buffer.from(response.audioBase64, 'base64') : undefined,
        error: response.error,
      };
    },
  };

  // ========== MEMORY ==========
  memory = {
    recall: async (userId: string, query?: string): Promise<Memory[]> => {
      const params = query ? `?query=${encodeURIComponent(query)}` : '';
      const response = await this.request<{ memories: Memory[] }>(
        'GET',
        `/api/memory/${userId}${params}`
      );
      return response.memories;
    },
  };

  // ========== PREFERENCES ==========
  preferences = {
    get: async (userId: string): Promise<UserPreferencesResponse> => {
      return this.request<UserPreferencesResponse>('GET', `/api/config/preferences/${userId}`);
    },

    update: async (userId: string, updates: Partial<UserPreferences>): Promise<UserPreferencesResponse> => {
      return this.request<UserPreferencesResponse>('PATCH', `/api/config/preferences/${userId}`, updates);
    },

    replace: async (userId: string, preferences: UserPreferences): Promise<UserPreferencesResponse> => {
      return this.request<UserPreferencesResponse>('PUT', `/api/config/preferences/${userId}`, preferences);
    },

    setProfile: async (userId: string, profile: 'silent' | 'informative' | 'control'): Promise<UserPreferencesResponse> => {
      return this.request<UserPreferencesResponse>(
        'POST',
        `/api/config/preferences/${userId}/profile/${profile}`
      );
    },

    getProfiles: async (): Promise<ProfilesResponse> => {
      return this.request<ProfilesResponse>('GET', '/api/config/preferences/profiles');
    },

    getGlobal: async (): Promise<{ preferences: UserPreferences }> => {
      return this.request<{ preferences: UserPreferences }>('GET', '/api/config/preferences');
    },

    setGlobal: async (preferences: Partial<UserPreferences>): Promise<{ preferences: UserPreferences }> => {
      return this.request<{ preferences: UserPreferences }>('PUT', '/api/config/preferences', preferences);
    },
  };

  // ========== DECISIONS ==========
  decisions = {
    getForRequest: async (requestId: string): Promise<DecisionsResponse> => {
      return this.request<DecisionsResponse>('GET', `/api/decisions/${requestId}`);
    },

    getSummary: async (requestId: string): Promise<DecisionSummary> => {
      return this.request<DecisionSummary>('GET', `/api/decisions/${requestId}/summary`);
    },

    getForUser: async (userId: string, limit?: number): Promise<UserDecisionsResponse> => {
      const params = limit ? `?limit=${limit}` : '';
      return this.request<UserDecisionsResponse>('GET', `/api/decisions/user/${userId}${params}`);
    },

    getRecent: async (limit?: number): Promise<{ count: number; decisions: any[] }> => {
      const params = limit ? `?limit=${limit}` : '';
      return this.request<{ count: number; decisions: any[] }>('GET', `/api/decisions/recent${params}`);
    },

    getStats: async (): Promise<DecisionsStats> => {
      return this.request<DecisionsStats>('GET', '/api/decisions/stats');
    },

    clearUser: async (userId: string): Promise<{ message: string }> => {
      return this.request<{ message: string }>('DELETE', `/api/decisions/user/${userId}`);
    },
  };

  // ========== LESSONS / LEARNING ==========
  lessons = {
    getForUser: async (userId: string): Promise<UserLessonsResponse> => {
      return this.request<UserLessonsResponse>('GET', `/api/lessons/${userId}`);
    },

    getForTask: async (userId: string, taskPattern: string, limit?: number): Promise<TaskLessonsResponse> => {
      const params = limit ? `?limit=${limit}` : '';
      return this.request<TaskLessonsResponse>('GET', `/api/lessons/${userId}/task/${taskPattern}${params}`);
    },

    getDetails: async (lessonId: string): Promise<LessonDetails> => {
      return this.request<LessonDetails>('GET', `/api/lessons/detail/${lessonId}`);
    },

    recordSuccess: async (
      userId: string,
      taskPattern: string,
      complexity: string,
      strategy: any
    ): Promise<{ success: boolean; lesson: any }> => {
      return this.request<{ success: boolean; lesson: any }>('POST', `/api/lessons/${userId}`, {
        taskPattern,
        complexity,
        strategy,
      });
    },

    recordFailure: async (
      userId: string,
      taskPattern: string,
      reason: string,
      whatWentWrong?: string
    ): Promise<{ success: boolean; lesson: any }> => {
      return this.request<{ success: boolean; lesson: any }>('POST', `/api/lessons/${userId}/failure`, {
        taskPattern,
        reason,
        whatWentWrong,
      });
    },

    delete: async (lessonId: string): Promise<{ success: boolean; message: string }> => {
      return this.request<{ success: boolean; message: string }>('DELETE', `/api/lessons/${lessonId}`);
    },

    clearUser: async (userId: string): Promise<{ success: boolean; message: string }> => {
      return this.request<{ success: boolean; message: string }>('DELETE', `/api/lessons/user/${userId}`);
    },

    getStats: async (): Promise<LessonStats> => {
      return this.request<LessonStats>('GET', '/api/lessons/stats');
    },
  };
}

export default EnzoApiClient;
