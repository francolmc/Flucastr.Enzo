import {
  UIMessage,
  ConfigData,
  AgentConfig,
  StatsData,
  StreamEvent,
  ProfilesConfigData,
  AssistantProfile,
  UserProfile,
  SystemConfigView,
  SystemConfigUpdatePayload,
  SkillRecord,
  SkillsResponse,
  InjectedSkillUsage,
} from '../types';

const BASE_URL = '/api';
const ENV = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const DEFAULT_REQUEST_TIMEOUT_MS = (() => {
  const raw = Number(ENV.VITE_API_TIMEOUT_MS ?? 300000);
  if (Number.isNaN(raw) || raw < 10000) return 300000;
  return raw;
})();

interface ApiError {
  error?: string;
  message?: string;
  statusCode?: number;
}

class ApiClient {
  private async request<T>(
    endpoint: string,
    options?: RequestInit,
    timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS
  ): Promise<T> {
    const url = `${BASE_URL}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let error: ApiError = {};
        try {
          error = (await response.json()) as ApiError;
        } catch {
          // Ignore JSON parsing errors and use HTTP status fallback.
        }
        const detail = error.message || error.error || `HTTP ${response.status}`;
        throw new Error(detail);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout: El servidor tardó demasiado en responder. Intenta de nuevo o activa el modo stream.');
      }
      console.error(`API Error [${endpoint}]:`, error);
      throw error;
    }
  }

  async sendMessage(
    userId: string,
    message: string,
    conversationId?: string,
    agentId?: string
  ): Promise<{
    content: string;
    conversationId: string;
    complexityUsed: string;
    providerUsed: string;
    modelUsed: string;
    injectedSkills: InjectedSkillUsage[];
    durationMs: number;
  }> {
    return this.request('/chat', {
      method: 'POST',
      body: JSON.stringify({
        userId,
        message,
        conversationId: conversationId || null,
        agentId: agentId || null,
      }),
    });
  }

  async sendMessageStream(
    userId: string,
    message: string,
    conversationId: string | undefined,
    agentId: string | undefined,
    onEvent: (event: StreamEvent) => void,
    onError?: (error: Error) => void,
    abortSignal?: AbortSignal
  ): Promise<void> {
    const url = `${BASE_URL}/chat/stream`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: abortSignal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          message,
          conversationId: conversationId || null,
          agentId: agentId || null,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Failed to send message`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body available');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        // Keep the last incomplete line in buffer
        buffer = lines[lines.length - 1];

        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (line.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(line.slice(6));
              onEvent(eventData);
            } catch (e) {
              console.error('Failed to parse SSE event:', line, e);
            }
          }
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Stream error:', err);
      if (onError) {
        onError(err);
      } else {
        throw err;
      }
    }
  }

  async getHistory(conversationId: string): Promise<UIMessage[]> {
    const response = await this.request<{ messages: any[] }>(
      `/chat/${conversationId}/history`
    );

    return response.messages.map((msg) => ({
      id: msg.id,
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
      modelUsed: msg.modelUsed,
      complexityUsed: msg.complexityUsed,
      durationMs: msg.durationMs,
      injectedSkills: Array.isArray(msg.injectedSkills) ? msg.injectedSkills : undefined,
      createdAt: msg.createdAt,
    }));
  }

  async getConversations(
    userId: string
  ): Promise<{ id: string; createdAt: number; updatedAt: number }[]> {
    const response = await this.request<{
      conversations: { id: string; createdAt: number; updatedAt: number }[];
    }>(`/chat/conversations/${userId}`);
    return response.conversations;
  }

  async getStats(
    userId: string,
    filters?: { from?: number; to?: number; source?: 'web' | 'telegram' | 'unknown' }
  ): Promise<StatsData> {
    const params = new URLSearchParams();
    if (filters?.from !== undefined) {
      params.set('from', String(filters.from));
    }
    if (filters?.to !== undefined) {
      params.set('to', String(filters.to));
    }
    if (filters?.source) {
      params.set('source', filters.source);
    }
    const query = params.toString();
    return this.request(`/stats/${userId}${query ? `?${query}` : ''}`);
  }

  async getConfig(): Promise<ConfigData> {
    return this.request('/config');
  }

  async testProvider(provider: string): Promise<{
    available: boolean;
    latencyMs: number;
  }> {
    return this.request('/config/test-provider', {
      method: 'POST',
      body: JSON.stringify({ provider }),
    });
  }

  async getAgents(userId: string): Promise<{ agents: AgentConfig[] }> {
    return this.request(`/agents/${userId}`);
  }

  async createAgent(
    userId: string,
    data: {
      name: string;
      description?: string;
      provider: string;
      model: string;
      systemPrompt?: string;
      assistantNameOverride?: string;
      personaOverride?: string;
      toneOverride?: string;
    }
  ): Promise<AgentConfig> {
    return this.request('/agents', {
      method: 'POST',
      body: JSON.stringify({ ...data, userId }),
    });
  }

  async updateAgent(
    id: string,
    data: {
      name?: string;
      description?: string;
      provider?: string;
      model?: string;
      systemPrompt?: string;
      assistantNameOverride?: string;
      personaOverride?: string;
      toneOverride?: string;
    }
  ): Promise<AgentConfig> {
    return this.request(`/agents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteAgent(id: string): Promise<{ success: boolean }> {
    return this.request(`/agents/${id}`, {
      method: 'DELETE',
    });
  }

  async getProfilesConfig(): Promise<ProfilesConfigData> {
    return this.request('/config/profiles');
  }

  async updateProfilesConfig(
    payload: {
      assistantProfile?: AssistantProfile;
      userProfile?: UserProfile;
    }
  ): Promise<{
    success: boolean;
    assistantProfile: AssistantProfile;
    userProfile: UserProfile;
  }> {
    return this.request('/config/profiles', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async deleteConversation(conversationId: string): Promise<{ success: boolean }> {
    return this.request(`/chat/${conversationId}`, {
      method: 'DELETE',
    });
  }

  // Model configuration APIs

  async getModelsConfig(): Promise<{
    primaryModel: string;
    runtimeModelSource?: 'env' | 'config';
    runtimeModelRequiresRestart?: boolean;
    fallbackModels: string[];
    availableOllamaModels: Array<{
      name: string;
      size?: number;
      modified?: string;
    }>;
    availableProviders: Array<{
      name: string;
      enabled: boolean;
      hasApiKey: boolean;
    }>;
  }> {
    return this.request('/config/models');
  }

  async updateModels(
    primaryModel: string,
    fallbackModels?: string[]
  ): Promise<{ success: boolean }> {
    return this.request('/config/models', {
      method: 'PUT',
      body: JSON.stringify({ primaryModel, fallbackModels }),
    });
  }

  async updateProviderApiKey(
    provider: string,
    apiKey: string
  ): Promise<{ success: boolean }> {
    return this.request(`/config/providers/${provider}/apikey`, {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    });
  }

  async getSystemConfig(): Promise<{ system: SystemConfigView }> {
    return this.request('/config/system');
  }

  async updateSystemConfig(payload: SystemConfigUpdatePayload): Promise<{ success: boolean; system: SystemConfigView }> {
    return this.request('/config/system', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async toggleProvider(
    provider: string,
    enabled: boolean
  ): Promise<{ success: boolean }> {
    return this.request(`/config/providers/${provider}/enabled`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  }

  // Skills APIs
  async getSkills(): Promise<SkillRecord[]> {
    const response = await this.request<SkillsResponse>('/skills');
    return response.skills || [];
  }

  async toggleSkill(id: string, enabled: boolean): Promise<{ success: boolean; skill: SkillRecord }> {
    const endpoint = enabled ? 'disable' : 'enable';
    return this.request(`/skills/${id}/${endpoint}`, {
      method: 'PUT',
    });
  }

  async reloadSkills(): Promise<{ count: number; skills: SkillRecord[] }> {
    return this.request('/skills/reload', {
      method: 'POST',
    });
  }

  // MCP APIs
  async getMCPServers(): Promise<any[]> {
    const response = await this.request<any>('/mcp/servers');
    return (response as any).servers || response || [];
  }

  // Backward-compatible alias while pages migrate to getMCPServers()
  async getMCPServersByPath(): Promise<any[]> {
    return this.getMCPServers();
  }

  // Backward-compatible alias while pages migrate to getMCPTools()
  async getAllMCPTools(): Promise<any[]> {
    return this.getMCPTools();
  }

  async connectMCPServer(config: any): Promise<any> {
    return this.request('/mcp/servers', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  async reconnectMCPServer(serverId: string): Promise<any> {
    return this.request(`/mcp/servers/${serverId}/reconnect`, {
      method: 'POST',
    });
  }

  async toggleMCPServer(serverId: string, enabled: boolean): Promise<any> {
    const endpoint = enabled ? 'disable' : 'enable';
    return this.request(`/mcp/servers/${serverId}/${endpoint}`, {
      method: 'PUT',
    });
  }

  async disconnectMCPServer(serverId: string): Promise<{ success: boolean }> {
    return this.request(`/mcp/servers/${serverId}`, {
      method: 'DELETE',
    });
  }

  async getMCPTools(serverId?: string): Promise<any[]> {
    const response = await this.request<any>('/mcp/tools');
    const allTools = (response as any).tools || response || [];
    if (!serverId) {
      return allTools;
    }
    return allTools.filter((tool: any) => tool.serverId === serverId);
  }
}

export const apiClient = new ApiClient();
