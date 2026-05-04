import { create } from 'zustand';
import { apiClient } from '../api/client';
import {
  UIMessage,
  ConversationItem,
  ConfigData,
  AgentConfig,
  StatsData,
  StreamEvent,
  AssistantProfile,
  UserProfile,
  InjectedSkillUsage,
  SystemConfigView,
  SystemConfigUpdatePayload,
  DailyRoutineConfig,
  DailyRoutineConfigUpdate,
} from '../types';

export type MessageState = 'pending' | 'streaming' | 'done' | 'failed';

interface MessageStatus {
  id: string;
  state: MessageState;
  error?: string;
  metadata?: {
    complexityUsed?: string;
    providerUsed?: string;
    modelUsed?: string;
    durationMs?: number;
    injectedSkills?: InjectedSkillUsage[];
  };
}

/** localStorage — must match Telegram user id (`String(telegram numeric id)`) to see Telegram memories in the web UI. */
const WEB_USER_ID_STORAGE_KEY = 'enzo_web_user_id';

function readStoredWebUserId(): string | null {
  if (typeof globalThis.window === 'undefined') {
    return null;
  }
  try {
    const v = localStorage.getItem(WEB_USER_ID_STORAGE_KEY);
    if (v != null && v.trim().length > 0) {
      return v.trim();
    }
    return null;
  } catch {
    return null;
  }
}

const VITE_META = typeof import.meta !== 'undefined'
  ? (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}
  : {};

function resolveInitialUserId(): string {
  const fromStorage = readStoredWebUserId();
  if (fromStorage) {
    return fromStorage;
  }
  const env = VITE_META.VITE_ENZO_USER_ID;
  if (typeof env === 'string' && env.trim().length > 0) {
    return env.trim();
  }
  return 'franco';
}

interface EnzoStore {
  // Chat
  userId: string;
  selectedAgentId: string | null;
  conversationId: string | null;
  conversations: ConversationItem[];
  messages: UIMessage[];
  isThinking: boolean;
  messageStatuses: Map<string, MessageStatus>;
  streamingAbortController?: AbortController;

  // Config
  config: ConfigData | null;
  /** Mensaje cuando GET /config falló (la página Config quedaba colgada en "Cargando"). */
  configLoadError: string | null;
  systemConfig: SystemConfigView | null;
  assistantProfile: AssistantProfile | null;
  userProfile: UserProfile | null;
  agents: AgentConfig[];
  dailyRoutineConfig: DailyRoutineConfig | null;

  // Models Config
  modelsConfig: {
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
  } | null;

  // Stats
  stats: StatsData | null;

  // Actions
  sendMessage: (message: string) => Promise<void>;
  sendMessageStream: (message: string) => Promise<void>;
  cancelStreaming: () => void;
  loadHistory: (conversationId: string) => Promise<void>;
  loadConversations: () => Promise<void>;
  loadConfig: () => Promise<void>;
  loadStats: (filters?: {
    from?: number;
    to?: number;
    source?: 'web' | 'telegram' | 'unknown';
  }) => Promise<void>;
  loadAgents: () => Promise<void>;
  loadProfilesConfig: () => Promise<void>;
  updateProfilesConfig: (payload: {
    assistantProfile?: AssistantProfile;
    userProfile?: UserProfile;
  }) => Promise<void>;
  loadModelsConfig: () => Promise<void>;
  updatePrimaryModel: (model: string) => Promise<void>;
  updateFallbackModels: (models: string[]) => Promise<void>;
  saveProviderApiKey: (provider: string, apiKey: string) => Promise<void>;
  toggleProvider: (provider: string, enabled: boolean) => Promise<void>;
  loadSystemConfig: () => Promise<void>;
  updateSystemConfig: (payload: SystemConfigUpdatePayload) => Promise<void>;
  loadDailyRoutineConfig: () => Promise<void>;
  updateDailyRoutineConfig: (payload: DailyRoutineConfigUpdate) => Promise<void>;
  newConversation: () => void;
  createAgent: (data: {
    name: string;
    description?: string;
    provider: string;
    model: string;
    systemPrompt?: string;
    assistantNameOverride?: string;
    personaOverride?: string;
    toneOverride?: string;
  }) => Promise<void>;
  updateAgent: (
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
  ) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  setConversationId: (id: string | null) => void;
  deleteConversation: (conversationId: string) => Promise<void>;
  getMessageStatus: (messageId: string) => MessageStatus | undefined;
  setSelectedAgentId: (agentId: string | null) => void;
  /** Align web UI with Telegram: use the same numeric string Telegram uses (`/memory` logs it). Persisted locally. */
  setUserId: (id: string) => void;
}

export const useEnzoStore = create<EnzoStore>((set, get) => ({
  // Initial state
  userId: resolveInitialUserId(),
  selectedAgentId: null,
  conversationId: null,
  conversations: [],
  messages: [],
  isThinking: false,
  messageStatuses: new Map(),
  config: null,
  configLoadError: null,
  systemConfig: null,
  assistantProfile: null,
  userProfile: null,
  agents: [],
  modelsConfig: null,
  stats: null,
  dailyRoutineConfig: null,

  // Actions
  sendMessage: async (message: string) => {
    const { userId, conversationId, selectedAgentId } = get();

    const userMessage: UIMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: message,
      createdAt: Date.now(),
    };

    set((state) => ({
      messages: [...state.messages, userMessage],
      isThinking: true,
    }));

    try {
      const response = await apiClient.sendMessage(
        userId,
        message,
        conversationId || undefined,
        selectedAgentId || undefined
      );

      if (!conversationId) {
        set({ conversationId: response.conversationId });
      }

      const assistantMessage: UIMessage = {
        id: `msg-${Date.now()}-assistant`,
        role: 'assistant',
        content: response.content,
        modelUsed: response.modelUsed,
        complexityUsed: response.complexityUsed,
        durationMs: response.durationMs,
        injectedSkills: response.injectedSkills,
        createdAt: Date.now(),
      };

      set((state) => ({
        messages: [...state.messages, assistantMessage],
        isThinking: false,
      }));

      await get().loadConversations();
    } catch (error) {
      console.error('Error sending message:', error);
      set({ isThinking: false });
      throw error;
    }
  },

  sendMessageStream: async (message: string) => {
    const { userId, conversationId, selectedAgentId } = get();
    const messageId = `msg-${Date.now()}-assistant`;

    const userMessage: UIMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: message,
      createdAt: Date.now(),
    };

    set((state) => ({
      messages: [...state.messages, userMessage],
      isThinking: true,
      messageStatuses: new Map(state.messageStatuses).set(messageId, {
        id: messageId,
        state: 'pending',
      }),
    }));

    const abortController = new AbortController();
    set({ streamingAbortController: abortController });

    let fullContent = '';
    let streamMetadata: any = {};

    try {
      await apiClient.sendMessageStream(
        userId,
        message,
        conversationId || undefined,
        selectedAgentId || undefined,
        (event: StreamEvent) => {
          switch (event.type) {
            case 'start':
              if (!conversationId && event.data.conversationId) {
                set({ conversationId: event.data.conversationId });
              }
              set((state) => ({
                messageStatuses: new Map(state.messageStatuses).set(messageId, {
                  id: messageId,
                  state: 'streaming',
                }),
              }));
              break;

            case 'progress':
              console.log('[Stream] Progress:', event.data);
              break;

            case 'chunk':
              fullContent += event.data.content || '';
              set((state) => {
                const messages = [...state.messages];
                const lastMsg = messages[messages.length - 1];
                if (lastMsg?.role === 'assistant') {
                  messages[messages.length - 1] = {
                    ...lastMsg,
                    content: fullContent,
                  };
                } else {
                  messages.push({
                    id: messageId,
                    role: 'assistant',
                    content: fullContent,
                    createdAt: Date.now(),
                  });
                }
                return { messages };
              });
              break;

            case 'done':
              streamMetadata = {
                complexityUsed: event.data.complexityUsed,
                providerUsed: event.data.providerUsed,
                modelUsed: event.data.modelUsed,
                durationMs: event.data.durationMs,
                injectedSkills: event.data.injectedSkills,
              };
              fullContent = event.data.content;
              set((state) => {
                const messages = [...state.messages];
                const lastMsg = messages[messages.length - 1];
                if (lastMsg?.role === 'assistant') {
                  messages[messages.length - 1] = {
                    ...lastMsg,
                    content: fullContent,
                    ...streamMetadata,
                  };
                }
                return {
                  messages,
                  messageStatuses: new Map(state.messageStatuses).set(messageId, {
                    id: messageId,
                    state: 'done',
                    metadata: streamMetadata,
                  }),
                  isThinking: false,
                  streamingAbortController: undefined,
                };
              });
              break;

            case 'error':
              set((state) => ({
                messageStatuses: new Map(state.messageStatuses).set(messageId, {
                  id: messageId,
                  state: 'failed',
                  error: event.data.message || 'Unknown error',
                }),
                isThinking: false,
                streamingAbortController: undefined,
              }));
              break;
          }
        },
        (error: Error) => {
          console.error('Stream error:', error);
          set((state) => ({
            messageStatuses: new Map(state.messageStatuses).set(messageId, {
              id: messageId,
              state: 'failed',
              error: error.message,
            }),
            isThinking: false,
            streamingAbortController: undefined,
          }));
        },
        abortController.signal
      );

      await get().loadConversations();
    } catch (error) {
      console.error('Error in stream:', error);
      set((state) => ({
        messageStatuses: new Map(state.messageStatuses).set(messageId, {
          id: messageId,
          state: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
        isThinking: false,
        streamingAbortController: undefined,
      }));
    }
  },

  cancelStreaming: () => {
    const { streamingAbortController } = get();
    if (streamingAbortController) {
      streamingAbortController.abort();
      set({
        isThinking: false,
        streamingAbortController: undefined,
      });
    }
  },

  loadHistory: async (conversationId: string) => {
    try {
      console.log('[Store] loadHistory called with conversationId:', conversationId);
      const messages = await apiClient.getHistory(conversationId);
      console.log('[Store] loadHistory received messages:', messages.length);
      set({ messages, conversationId });
      console.log('[Store] loadHistory state updated with conversationId:', conversationId);
    } catch (error) {
      console.error('Error loading history:', error);
      throw error;
    }
  },

  loadConversations: async () => {
    const { userId } = get();
    try {
      const conversations = await apiClient.getConversations(userId);
      set({ conversations });
    } catch (error) {
      console.error('Error loading conversations:', error);
      throw error;
    }
  },

  loadConfig: async () => {
    try {
      const config = await apiClient.getConfig();
      set({
        config,
        configLoadError: null,
        systemConfig: config.systemConfig || null,
        assistantProfile: config.assistantProfile || null,
        userProfile: config.userProfile || null,
      });
    } catch (error) {
      console.error('Error loading config:', error);
      const msg = error instanceof Error ? error.message : String(error);
      set({
        configLoadError: msg,
      });
    }
  },

  loadStats: async (filters) => {
    const { userId } = get();
    try {
      const stats = await apiClient.getStats(userId, filters);
      set({ stats });
    } catch (error) {
      console.error('Error loading stats:', error);
      throw error;
    }
  },

  loadAgents: async () => {
    const { userId } = get();
    try {
      const response = await apiClient.getAgents(userId);
      set((state) => {
        const hasSelectedAgent = state.selectedAgentId
          ? response.agents.some((agent) => agent.id === state.selectedAgentId)
          : false;
        return {
          agents: response.agents,
          selectedAgentId: hasSelectedAgent ? state.selectedAgentId : null,
        };
      });
    } catch (error) {
      console.error('Error loading agents:', error);
      throw error;
    }
  },

  loadProfilesConfig: async () => {
    try {
      const profiles = await apiClient.getProfilesConfig();
      set({
        assistantProfile: profiles.assistantProfile,
        userProfile: profiles.userProfile,
      });
    } catch (error) {
      console.error('Error loading profiles config:', error);
      throw error;
    }
  },

  updateProfilesConfig: async (payload) => {
    try {
      const response = await apiClient.updateProfilesConfig(payload);
      set({
        assistantProfile: response.assistantProfile,
        userProfile: response.userProfile,
      });
    } catch (error) {
      console.error('Error updating profiles config:', error);
      throw error;
    }
  },

  newConversation: () => {
    set({
      conversationId: null,
      messages: [],
    });
  },

  createAgent: async (data) => {
    const { userId } = get();
    try {
      await apiClient.createAgent(userId, data);
      await get().loadAgents();
    } catch (error) {
      console.error('Error creating agent:', error);
      throw error;
    }
  },

  updateAgent: async (id, data) => {
    try {
      await apiClient.updateAgent(id, data);
      await get().loadAgents();
    } catch (error) {
      console.error('Error updating agent:', error);
      throw error;
    }
  },

  deleteAgent: async (id: string) => {
    try {
      await apiClient.deleteAgent(id);
      await get().loadAgents();
    } catch (error) {
      console.error('Error deleting agent:', error);
      throw error;
    }
  },

  loadModelsConfig: async () => {
    try {
      const modelsConfig = await apiClient.getModelsConfig();
      set({ modelsConfig });
    } catch (error) {
      console.error('Error loading models config:', error);
      throw error;
    }
  },

  updatePrimaryModel: async (model: string) => {
    try {
      await apiClient.updateModels(model);
      await get().loadModelsConfig();
    } catch (error) {
      console.error('Error updating primary model:', error);
      throw error;
    }
  },

  updateFallbackModels: async (models: string[]) => {
    const { modelsConfig } = get();
    const primaryModel = modelsConfig?.primaryModel || 'qwen2.5:7b';
    try {
      await apiClient.updateModels(primaryModel, models);
      await get().loadModelsConfig();
    } catch (error) {
      console.error('Error updating fallback models:', error);
      throw error;
    }
  },

  saveProviderApiKey: async (provider: string, apiKey: string) => {
    try {
      await apiClient.updateProviderApiKey(provider, apiKey);
      await get().loadModelsConfig();
    } catch (error) {
      console.error('Error saving provider API key:', error);
      throw error;
    }
  },

  toggleProvider: async (provider: string, enabled: boolean) => {
    try {
      await apiClient.toggleProvider(provider, enabled);
      await get().loadModelsConfig();
    } catch (error) {
      console.error('Error toggling provider:', error);
      throw error;
    }
  },

  loadSystemConfig: async () => {
    try {
      const response = await apiClient.getSystemConfig();
      set({ systemConfig: response.system });
    } catch (error) {
      console.error('Error loading system config:', error);
      throw error;
    }
  },

  updateSystemConfig: async (payload: SystemConfigUpdatePayload) => {
    try {
      const response = await apiClient.updateSystemConfig(payload);
      set({ systemConfig: response.system });
      await get().loadConfig();
    } catch (error) {
      console.error('Error updating system config:', error);
      throw error;
    }
  },

  loadDailyRoutineConfig: async () => {
    try {
      const response = await apiClient.getDailyRoutineConfig();
      set({ dailyRoutineConfig: response.dailyRoutine });
    } catch (error) {
      console.error('Error loading daily routine config:', error);
      throw error;
    }
  },

  updateDailyRoutineConfig: async (payload: DailyRoutineConfigUpdate) => {
    try {
      const response = await apiClient.updateDailyRoutineConfig(payload);
      set({ dailyRoutineConfig: response.dailyRoutine });
    } catch (error) {
      console.error('Error updating daily routine config:', error);
      throw error;
    }
  },

  setConversationId: (id: string | null) => {
    set({ conversationId: id });
  },

  setSelectedAgentId: (agentId: string | null) => {
    set({ selectedAgentId: agentId });
  },

  setUserId: (id: string) => {
    const trimmed = id.trim();
    const next = trimmed.length > 0 ? trimmed : 'franco';
    set({ userId: next });
    try {
      localStorage.setItem(WEB_USER_ID_STORAGE_KEY, next);
    } catch {
      /* ignore quota / private mode */
    }
  },

  deleteConversation: async (conversationId: string) => {
    const previousState = get();
    const hadConversation = previousState.conversations.some((conv) => conv.id === conversationId);

    // Optimistic update to make deletion feel instant in UI.
    set((state) => ({
      conversations: state.conversations.filter((conv) => conv.id !== conversationId),
      ...(state.conversationId === conversationId
        ? { conversationId: null, messages: [] }
        : {}),
    }));

    try {
      await apiClient.deleteConversation(conversationId);
      await get().loadConversations();
    } catch (error) {
      console.error('Error deleting conversation:', error);
      // Rollback if API deletion failed.
      if (hadConversation) {
        set({
          conversations: previousState.conversations,
          conversationId: previousState.conversationId,
          messages: previousState.messages,
        });
      }
      throw error;
    }
  },

  getMessageStatus: (messageId: string) => {
    const { messageStatuses } = get();
    return messageStatuses.get(messageId);
  },
}));
