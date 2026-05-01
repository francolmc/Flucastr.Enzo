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
  UIMemory,
  UIMemoryHistoryItem,
  EchoEngineStatus,
  EchoResult,
  DeclarativeEchoJobDTO,
  EchoDeclarativeJobsResponse,
  Notification,
  Project,
  EmailAccountConfigDTO,
  EmailMessageDTO,
  CalendarEventDTO,
} from '../types';

const BASE_URL = '/api';
const ENV = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
/** Long operations (POST /chat, etc.) — override with VITE_API_TIMEOUT_MS. */
const DEFAULT_REQUEST_TIMEOUT_MS = (() => {
  const raw = Number(ENV.VITE_API_TIMEOUT_MS ?? 180000);
  if (Number.isNaN(raw) || raw < 15000) return 180000;
  return raw;
})();
/** List / GET pages (config, memoria, conversaciones) — fail fast so the UI no queda colgada minutos. */
const API_QUICK_READ_TIMEOUT_MS = (() => {
  const raw = Number(ENV.VITE_API_QUICK_TIMEOUT_MS ?? 45000);
  if (Number.isNaN(raw) || raw < 5000) return 45000;
  return Math.min(raw, 120000);
})();

function normalizeNetworkError(error: unknown, endpoint: string): Error {
  if (error instanceof Error && error.name === 'AbortError') {
    return new Error(
      `Timeout (${endpoint}): el servidor no respondió a tiempo. Si usás Cloudflare y ves 524, el origen está caído o muy lento.`
    );
  }
  if (error instanceof TypeError && /fetch|network|failed to load/i.test(String(error.message))) {
    return new Error(
      `Sin conexión con la API (${endpoint}). Comprueba red, proxy /api y que el backend esté en marcha. ` +
        `(524 Cloudflare = origen timeout). "Receiving end does not exist" suele venir de una extensión del navegador.`
    );
  }
  if (error instanceof Error) {
    const m = error.message;
    if (
      m.includes('Failed to fetch') ||
      m.includes('NetworkError') ||
      m.includes('Network request failed') ||
      m.includes('Load failed')
    ) {
      return new Error(
        `Sin conexión con la API (${endpoint}). ¿Está corriendo el backend y el proxy sirve /api? ` +
          `524 = timeout en el proxy (Cloudflare). El mensaje "Receiving end does not exist" suele ser un plugin del navegador, no Enzo.`
      );
    }
    if (/\b524\b/.test(m) || m.includes('HTTP 524')) {
      return new Error(
        `HTTP 524: el origen no respondió a tiempo (típico de Cloudflare). Revisá túnel, firewall y que la API esté en marcha.`
      );
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

interface ApiError {
  error?: string;
  message?: string;
  statusCode?: number;
  details?: unknown;
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
          const errText = await response.text();
          if (errText.trim()) {
            error = JSON.parse(errText) as ApiError;
          }
        } catch {
          // Ignore JSON parsing errors and use HTTP status fallback.
        }
        const base = error.message || error.error || `HTTP ${response.status}`;
        const extra =
          error.details !== undefined ? ` · ${typeof error.details === 'string' ? error.details : JSON.stringify(error.details)}` : '';
        throw new Error(base + extra);
      }

      const bodyText = await response.text();
      if (!bodyText.trim()) {
        return {} as T;
      }
      return JSON.parse(bodyText) as T;
    } catch (error) {
      clearTimeout(timeoutId);
      console.error(`API Error [${endpoint}]:`, error);
      throw normalizeNetworkError(error, endpoint);
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
    return this.request(
      '/chat',
      {
        method: 'POST',
        body: JSON.stringify({
          userId,
          message,
          conversationId: conversationId || null,
          agentId: agentId || null,
        }),
      },
      DEFAULT_REQUEST_TIMEOUT_MS
    );
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
      `/chat/${conversationId}/history`,
      undefined,
      API_QUICK_READ_TIMEOUT_MS
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
    }>(`/chat/conversations/${userId}`, undefined, API_QUICK_READ_TIMEOUT_MS);
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
    return this.request(`/stats/${userId}${query ? `?${query}` : ''}`, undefined, API_QUICK_READ_TIMEOUT_MS);
  }

  async getConfig(): Promise<ConfigData> {
    return this.request('/config', undefined, API_QUICK_READ_TIMEOUT_MS);
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
    return this.request(`/agents/${userId}`, undefined, API_QUICK_READ_TIMEOUT_MS);
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
    return this.request('/config/profiles', undefined, API_QUICK_READ_TIMEOUT_MS);
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
    return this.request(
      `/chat/${conversationId}`,
      {
        method: 'DELETE',
      },
      API_QUICK_READ_TIMEOUT_MS
    );
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
    return this.request('/config/models', undefined, API_QUICK_READ_TIMEOUT_MS);
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
    return this.request('/config/system', undefined, API_QUICK_READ_TIMEOUT_MS);
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
    const response = await this.request<SkillsResponse>('/skills', undefined, API_QUICK_READ_TIMEOUT_MS);
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

  async getSkillSource(id: string): Promise<{ markdown: string }> {
    return this.request(
      `/skills/${encodeURIComponent(id)}/source`,
      undefined,
      API_QUICK_READ_TIMEOUT_MS
    );
  }

  async putSkillSource(
    id: string,
    markdown: string
  ): Promise<{ success: boolean; skill: SkillRecord }> {
    return this.request(`/skills/${encodeURIComponent(id)}/source`, {
      method: 'PUT',
      body: JSON.stringify({ markdown }),
    });
  }

  async createSkill(
    id: string,
    markdown: string
  ): Promise<{ success: boolean; skill: SkillRecord }> {
    return this.request('/skills', {
      method: 'POST',
      body: JSON.stringify({ id, markdown }),
    });
  }

  async deleteSkill(id: string): Promise<{ success: boolean }> {
    return this.request(`/skills/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  // Memory APIs
  async getMemory(userId: string): Promise<{ memories: UIMemory[] }> {
    return this.request(`/memory/${encodeURIComponent(userId)}`, undefined, API_QUICK_READ_TIMEOUT_MS);
  }

  async createMemory(userId: string, key: string, value: string): Promise<void> {
    await this.request(
      `/memory/${encodeURIComponent(userId)}`,
      {
        method: 'POST',
        body: JSON.stringify({ key, value }),
      },
      API_QUICK_READ_TIMEOUT_MS
    );
  }

  async updateMemory(userId: string, key: string, value: string): Promise<void> {
    await this.request(
      `/memory/${encodeURIComponent(userId)}/${encodeURIComponent(key)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ value }),
      },
      API_QUICK_READ_TIMEOUT_MS
    );
  }

  async deleteMemory(userId: string, key: string): Promise<void> {
    await this.request(
      `/memory/${encodeURIComponent(userId)}/${encodeURIComponent(key)}`,
      {
        method: 'DELETE',
      },
      API_QUICK_READ_TIMEOUT_MS
    );
  }

  async getMemoryHistory(userId: string, key: string): Promise<{ history: UIMemoryHistoryItem[] }> {
    return this.request(
      `/memory/${encodeURIComponent(userId)}/${encodeURIComponent(key)}/history`,
      undefined,
      API_QUICK_READ_TIMEOUT_MS
    );
  }

  // Echo APIs
  async getEchoStatus(): Promise<EchoEngineStatus> {
    return this.request('/echo/status', undefined, API_QUICK_READ_TIMEOUT_MS);
  }

  async runEchoTask(taskId: string): Promise<EchoResult> {
    return this.request(
      `/echo/${encodeURIComponent(taskId)}/run`,
      {
        method: 'POST',
      },
      API_QUICK_READ_TIMEOUT_MS
    );
  }

  async toggleEchoTask(taskId: string): Promise<void> {
    await this.request(
      `/echo/${encodeURIComponent(taskId)}/toggle`,
      {
        method: 'POST',
      },
      API_QUICK_READ_TIMEOUT_MS
    );
  }

  async getEchoDeclarativeJobs(): Promise<EchoDeclarativeJobsResponse> {
    return this.request('/echo/declarative-jobs', undefined, API_QUICK_READ_TIMEOUT_MS);
  }

  async createEchoDeclarativeJob(job: DeclarativeEchoJobDTO): Promise<{ job: DeclarativeEchoJobDTO }> {
    return this.request(
      '/echo/declarative-jobs',
      { method: 'POST', body: JSON.stringify(job) },
      API_QUICK_READ_TIMEOUT_MS
    );
  }

  async updateEchoDeclarativeJob(id: string, job: DeclarativeEchoJobDTO): Promise<{ job: DeclarativeEchoJobDTO }> {
    return this.request(
      `/echo/declarative-jobs/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify(job) },
      API_QUICK_READ_TIMEOUT_MS
    );
  }

  async deleteEchoDeclarativeJob(id: string): Promise<void> {
    await this.request(
      `/echo/declarative-jobs/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      API_QUICK_READ_TIMEOUT_MS
    );
  }

  async patchEchoSettings(body: { cronTimezone?: string }): Promise<void> {
    await this.request('/echo/settings', { method: 'PATCH', body: JSON.stringify(body) }, API_QUICK_READ_TIMEOUT_MS);
  }

  async getCalendarEvents(
    userId: string,
    fromIso: string,
    toIso: string
  ): Promise<{ events: CalendarEventDTO[] }> {
    const q = new URLSearchParams({ from: fromIso, to: toIso });
    return this.request(
      `/calendar/${encodeURIComponent(userId)}/events?${q.toString()}`,
      undefined,
      API_QUICK_READ_TIMEOUT_MS
    );
  }

  async createCalendarEvent(
    userId: string,
    body: { title: string; startIso: string; endIso?: string | null; notes?: string | null }
  ): Promise<{ event: CalendarEventDTO }> {
    return this.request(
      `/calendar/${encodeURIComponent(userId)}/events`,
      { method: 'POST', body: JSON.stringify(body) },
      API_QUICK_READ_TIMEOUT_MS
    );
  }

  async updateCalendarEvent(
    userId: string,
    eventId: string,
    body: { title?: string; startIso?: string; endIso?: string | null; notes?: string | null }
  ): Promise<{ event: CalendarEventDTO }> {
    return this.request(
      `/calendar/${encodeURIComponent(userId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
      API_QUICK_READ_TIMEOUT_MS
    );
  }

  async deleteCalendarEvent(userId: string, eventId: string): Promise<void> {
    await this.request(
      `/calendar/${encodeURIComponent(userId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE' },
      API_QUICK_READ_TIMEOUT_MS
    );
  }

  async getRecentNotifications(userId: string): Promise<Notification[]> {
    const data = await this.request<Notification[] | { error?: string }>(
      `/echo/notifications/${encodeURIComponent(userId)}`,
      undefined,
      API_QUICK_READ_TIMEOUT_MS
    );
    return Array.isArray(data) ? data : [];
  }

  // Projects API
  async getProjects(userId: string): Promise<{ projects: Project[] }> {
    return this.request(`/projects/${encodeURIComponent(userId)}`, undefined, API_QUICK_READ_TIMEOUT_MS);
  }

  async getEmailAccounts(): Promise<EmailAccountConfigDTO[]> {
    const data = await this.request<{ accounts: EmailAccountConfigDTO[] }>(
      '/email/accounts',
      undefined,
      API_QUICK_READ_TIMEOUT_MS
    );
    return data.accounts ?? [];
  }

  async testEmailAccount(id: string): Promise<{ success: boolean; error?: string }> {
    return this.request(`/email/accounts/${encodeURIComponent(id)}/test`, {
      method: 'POST',
    });
  }

  async setEmailPassword(id: string, password: string): Promise<void> {
    await this.request(`/email/accounts/${encodeURIComponent(id)}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password }),
    });
  }

  async toggleEmailAccount(id: string, enabled: boolean): Promise<void> {
    await this.request(`/email/accounts/${encodeURIComponent(id)}/toggle`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  }

  async getRecentEmails(limit?: number): Promise<EmailMessageDTO[]> {
    const q =
      typeof limit === 'number' ? `?limit=${encodeURIComponent(String(limit))}` : '';
    const data = await this.request<{ messages: EmailMessageDTO[] }>(
      `/email/recent${q}`,
      undefined,
      API_QUICK_READ_TIMEOUT_MS
    );
    return data.messages ?? [];
  }

  // MCP APIs
  async getMCPServers(): Promise<any[]> {
    const response = await this.request<any>('/mcp/servers', undefined, API_QUICK_READ_TIMEOUT_MS);
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
    const response = await this.request<any>('/mcp/tools', undefined, API_QUICK_READ_TIMEOUT_MS);
    const allTools = (response as any).tools || response || [];
    if (!serverId) {
      return allTools;
    }
    return allTools.filter((tool: any) => tool.serverId === serverId);
  }
}

export const apiClient = new ApiClient();
