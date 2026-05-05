import fs from 'fs';
import path from 'path';
import { EncryptionService } from '../security/EncryptionService.js';

export interface ProviderConfig {
  name: string;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyEncrypted?: string;
}

export interface ModelsConfig {
  primaryModel: string;
  primaryProvider?: string;
  fallbackModels: string[];
  fallbackProvider?: string;
  fallbackModel?: string;
  providers: Record<string, ProviderConfig>;
  system: StoredSystemConfig;
  assistantProfile: AssistantProfile;
  userProfile: UserProfile;
}

export interface AssistantProfile {
  name: string;
  persona?: string;
  tone?: string;
  styleGuidelines?: string;
}

export interface UserProfile {
  displayName?: string;
  profession?: string;
  importantInfo?: string;
  preferences?: string;
  locale?: string;
  timezone?: string;
}

export interface StoredSystemConfig {
  ollamaBaseUrl: string;
  anthropicModel: string;
  port: string;
  uiPort: string;
  dbPath: string;
  enzoWorkspacePath: string;
  enzoSkillsPath: string;
  enzoDebug: boolean;
  enzoSkillsFallbackRelevanceThreshold: number;
  mcpAutoConnect: boolean;
  defaultUserLanguage: string;
  tz: string;
  telegramAllowedUsers: string;
  telegramAgentOwnerUserId: string;
  /** When true, Telegram may auto-pick an agent from message text. Default off: use `/agent` only. */
  telegramAgentAutoroute?: boolean;
  /** Min confidence (0–0.95) to persist a fact from memory extraction. Synced to `ENZO_MEMORY_CONFIDENCE_THRESHOLD`. */
  enzoMemoryConfidenceThreshold: number;
  /** Short verification pass before final synthesis. Synced to `ENZO_VERIFY_BEFORE_SYNTHESIS`. */
  enzoVerifyBeforeSynthesis: boolean;
  /**
   * When no skill is enabled, still consider all loaded skills for relevance. Synced to `ENZO_SKILLS_FALLBACK_ALL_WHEN_NONE_ENABLED`.
   * Default true (disabled only if env is the string `false`).
   */
  enzoSkillsFallbackAllWhenNoneEnabled: boolean;
  /** Prefer native tool-calling in the think phase. Synced to `ENZO_NATIVE_TOOL_CALLING`. */
  enzoNativeToolCalling: boolean;
  telegramBotTokenEncrypted?: string;
  tavilyApiKeyEncrypted?: string;
}

export interface SystemConfigView {
  ollamaBaseUrl: string;
  anthropicModel: string;
  port: string;
  uiPort: string;
  dbPath: string;
  enzoWorkspacePath: string;
  enzoSkillsPath: string;
  enzoDebug: boolean;
  enzoSkillsFallbackRelevanceThreshold: number;
  mcpAutoConnect: boolean;
  enzoNativeToolCalling: boolean;
  defaultUserLanguage: string;
  tz: string;
  telegramAllowedUsers: string;
  telegramAgentOwnerUserId: string;
  telegramAgentAutoroute: boolean;
  hasTelegramBotToken: boolean;
  hasTavilyApiKey: boolean;
  secretStoragePath: string;
}

export interface SystemConfigUpdate {
  ollamaBaseUrl?: string;
  anthropicModel?: string;
  port?: string;
  uiPort?: string;
  dbPath?: string;
  enzoWorkspacePath?: string;
  enzoSkillsPath?: string;
  enzoDebug?: boolean;
  enzoSkillsFallbackRelevanceThreshold?: number;
  mcpAutoConnect?: boolean;
  defaultUserLanguage?: string;
  tz?: string;
  telegramAllowedUsers?: string;
  telegramAgentOwnerUserId?: string;
  telegramAgentAutoroute?: boolean;
  telegramBotToken?: string;
  tavilyApiKey?: string;
  enzoMemoryConfidenceThreshold?: number;
  enzoVerifyBeforeSynthesis?: boolean;
  enzoSkillsFallbackAllWhenNoneEnabled?: boolean;
  enzoNativeToolCalling?: boolean;
}

const KNOWN_PROVIDERS = ['ollama', 'anthropic', 'openai', 'gemini'] as const;
const SUPPORTED_LANGUAGES = ['es', 'en', 'pt', 'fr', 'de', 'it', 'zh', 'ja', 'ko', 'ar', 'ru'] as const;

function defaultMemoryConfidenceThresholdFromEnv(): number {
  const n = Number(process.env.ENZO_MEMORY_CONFIDENCE_THRESHOLD);
  if (!Number.isFinite(n)) return 0.55;
  return Math.min(0.95, Math.max(0, n));
}

function booleanFromEnvKey(envKey: string, defaultValue: boolean): boolean {
  const raw = process.env[envKey];
  if (raw === undefined || raw === '') return defaultValue;
  return raw.toLowerCase() === 'true';
}

function booleanFromEnvDefaultTrue(envKey: string): boolean {
  const raw = process.env[envKey];
  if (raw === undefined || raw === '') return true;
  return raw.toLowerCase() !== 'false';
}

function normalizeStoredBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value === true || value === false) return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return defaultValue;
}

function normalizeFallbackAllWhenNone(value: unknown, defaultValue: boolean): boolean {
  if (value === true || value === false) return value;
  if (typeof value === 'string') return value.toLowerCase() !== 'false';
  return defaultValue;
}

function getDefaultConfig(): ModelsConfig {
  return {
    primaryModel: process.env.OLLAMA_PRIMARY_MODEL || 'qwen2.5:7b',
    fallbackModels: [],
    providers: {
      ollama: {
        name: 'ollama',
        enabled: true,
        hasApiKey: false,
      },
      anthropic: {
        name: 'anthropic',
        enabled: !!process.env.ANTHROPIC_API_KEY,
        hasApiKey: !!process.env.ANTHROPIC_API_KEY,
      },
      openai: {
        name: 'openai',
        enabled: !!process.env.OPENAI_API_KEY,
        hasApiKey: !!process.env.OPENAI_API_KEY,
      },
      gemini: {
        name: 'gemini',
        enabled: !!process.env.GEMINI_API_KEY,
        hasApiKey: !!process.env.GEMINI_API_KEY,
      },
    },
    system: {
      ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest',
      port: process.env.PORT || '3001',
      uiPort: process.env.ENZO_UI_PORT || '5173',
      dbPath: process.env.DB_PATH || './enzo.db',
      enzoWorkspacePath: process.env.ENZO_WORKSPACE_PATH || './workspace',
      enzoSkillsPath: process.env.ENZO_SKILLS_PATH || '~/.enzo/skills',
      enzoDebug: (process.env.ENZO_DEBUG || 'false').toLowerCase() === 'true',
      enzoSkillsFallbackRelevanceThreshold: Number(process.env.ENZO_SKILLS_FALLBACK_RELEVANCE_THRESHOLD ?? 0.12),
      mcpAutoConnect: (process.env.MCP_AUTO_CONNECT || 'false').toLowerCase() === 'true',
      defaultUserLanguage: process.env.DEFAULT_USER_LANGUAGE || 'es',
      tz: process.env.TZ || 'America/Santiago',
      telegramAllowedUsers: process.env.TELEGRAM_ALLOWED_USERS || '',
      telegramAgentOwnerUserId: process.env.TELEGRAM_AGENT_OWNER_USER_ID || '',
      telegramAgentAutoroute: (process.env.TELEGRAM_AGENT_AUTOROUTE || '').toLowerCase() === 'true',
      enzoMemoryConfidenceThreshold: defaultMemoryConfidenceThresholdFromEnv(),
      enzoVerifyBeforeSynthesis: booleanFromEnvKey('ENZO_VERIFY_BEFORE_SYNTHESIS', false),
      enzoSkillsFallbackAllWhenNoneEnabled: booleanFromEnvDefaultTrue('ENZO_SKILLS_FALLBACK_ALL_WHEN_NONE_ENABLED'),
      enzoNativeToolCalling: booleanFromEnvKey('ENZO_NATIVE_TOOL_CALLING', false),
    },
    assistantProfile: {
      name: 'Enzo',
      persona: 'Intelligent personal assistant',
      tone: 'direct, concise, friendly',
      styleGuidelines: '',
    },
    userProfile: {},
  };
}

/**
 * Service for managing application configuration
 * Persists to a JSON file in the user's home directory (~/.enzo/config.json)
 * Handles encryption of sensitive data like API keys
 */
export class ConfigService {
  private config: ModelsConfig;
  private configPath: string;
  private encryptionService: EncryptionService;

  constructor(encryptionService: EncryptionService, configPath?: string) {
    this.encryptionService = encryptionService;

    // Determine config file path
    if (configPath) {
      this.configPath = configPath;
    } else {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
      this.configPath = path.join(homeDir, '.enzo', 'config.json');
    }

    // Load or initialize config
    this.config = this.loadConfig();
    try {
      this.saveConfig();
    } catch (error) {
      console.error('[ConfigService] Could not persist config on startup — API will still run. Fix file permissions:', error);
    }
    this.applySystemEnvironment();
  }

  private hydrateConfig(loaded?: Partial<ModelsConfig>): ModelsConfig {
    const defaults = getDefaultConfig();
    const providers: Record<string, ProviderConfig> = { ...defaults.providers };
    const system: StoredSystemConfig = {
      ...defaults.system,
      ...(loaded?.system || {}),
    };
    if (!Number.isFinite(system.enzoSkillsFallbackRelevanceThreshold)) {
      system.enzoSkillsFallbackRelevanceThreshold = defaults.system.enzoSkillsFallbackRelevanceThreshold;
    }
    system.enzoSkillsFallbackRelevanceThreshold = Math.max(
      0,
      Math.min(1, system.enzoSkillsFallbackRelevanceThreshold)
    );

    if (!Number.isFinite(system.enzoMemoryConfidenceThreshold)) {
      system.enzoMemoryConfidenceThreshold = defaults.system.enzoMemoryConfidenceThreshold;
    }
    system.enzoMemoryConfidenceThreshold = Math.max(0, Math.min(0.95, system.enzoMemoryConfidenceThreshold));

    system.enzoVerifyBeforeSynthesis = normalizeStoredBoolean(
      system.enzoVerifyBeforeSynthesis,
      defaults.system.enzoVerifyBeforeSynthesis
    );
    system.enzoSkillsFallbackAllWhenNoneEnabled = normalizeFallbackAllWhenNone(
      system.enzoSkillsFallbackAllWhenNoneEnabled,
      defaults.system.enzoSkillsFallbackAllWhenNoneEnabled
    );
    system.enzoNativeToolCalling = normalizeStoredBoolean(
      system.enzoNativeToolCalling,
      defaults.system.enzoNativeToolCalling
    );

    if (loaded?.providers) {
      for (const [key, provider] of Object.entries(loaded.providers)) {
        providers[key] = {
          name: provider.name || key,
          enabled: provider.enabled ?? false,
          hasApiKey: provider.hasApiKey ?? false,
          apiKeyEncrypted: provider.apiKeyEncrypted,
        };
      }
    }

    for (const providerName of KNOWN_PROVIDERS) {
      if (!providers[providerName]) {
        providers[providerName] = {
          name: providerName,
          enabled: false,
          hasApiKey: false,
        };
      }
    }

    return {
      primaryModel: loaded?.primaryModel || defaults.primaryModel,
      primaryProvider: typeof loaded?.primaryProvider === 'string' ? loaded.primaryProvider : undefined,
      fallbackModels: Array.isArray(loaded?.fallbackModels)
        ? [...loaded.fallbackModels]
        : defaults.fallbackModels,
      fallbackProvider: typeof loaded?.fallbackProvider === 'string' ? loaded.fallbackProvider : undefined,
      fallbackModel: typeof loaded?.fallbackModel === 'string' ? loaded.fallbackModel : undefined,
      providers,
      system,
      assistantProfile: {
        ...defaults.assistantProfile,
        ...(loaded?.assistantProfile || {}),
      },
      userProfile: {
        ...defaults.userProfile,
        ...(loaded?.userProfile || {}),
      },
    };
  }

  private bootstrapProviderApiKeyFromEnv(config: ModelsConfig, provider: string, envVarName: string): void {
    const envKey = process.env[envVarName];
    const providerConfig = config.providers[provider];
    if (!providerConfig || !envKey || providerConfig.apiKeyEncrypted) {
      return;
    }

    providerConfig.apiKeyEncrypted = this.encryptionService.encrypt(envKey);
    providerConfig.hasApiKey = true;
    providerConfig.enabled = true;
  }

  private bootstrapSystemSecretFromEnv(
    config: ModelsConfig,
    encryptedField: 'telegramBotTokenEncrypted' | 'tavilyApiKeyEncrypted',
    envVarName: 'TELEGRAM_BOT_TOKEN' | 'TAVILY_API_KEY'
  ): void {
    const envValue = process.env[envVarName];
    if (!envValue || config.system[encryptedField]) {
      return;
    }
    config.system[encryptedField] = this.encryptionService.encrypt(envValue);
  }

  private loadConfig(): ModelsConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        const loaded = JSON.parse(data) as Partial<ModelsConfig>;
        console.log('[ConfigService] ✓ Config loaded from', this.configPath);
        const hydrated = this.hydrateConfig(loaded);
        this.bootstrapProviderApiKeyFromEnv(hydrated, 'anthropic', 'ANTHROPIC_API_KEY');
        this.bootstrapProviderApiKeyFromEnv(hydrated, 'openai', 'OPENAI_API_KEY');
        this.bootstrapProviderApiKeyFromEnv(hydrated, 'gemini', 'GEMINI_API_KEY');
        this.bootstrapSystemSecretFromEnv(hydrated, 'telegramBotTokenEncrypted', 'TELEGRAM_BOT_TOKEN');
        this.bootstrapSystemSecretFromEnv(hydrated, 'tavilyApiKeyEncrypted', 'TAVILY_API_KEY');
        return hydrated;
      }
    } catch (error) {
      console.warn('[ConfigService] Failed to load config file, using defaults:', error);
    }

    const fallback = this.hydrateConfig();
    this.bootstrapProviderApiKeyFromEnv(fallback, 'anthropic', 'ANTHROPIC_API_KEY');
    this.bootstrapProviderApiKeyFromEnv(fallback, 'openai', 'OPENAI_API_KEY');
    this.bootstrapProviderApiKeyFromEnv(fallback, 'gemini', 'GEMINI_API_KEY');
    this.bootstrapSystemSecretFromEnv(fallback, 'telegramBotTokenEncrypted', 'TELEGRAM_BOT_TOKEN');
    this.bootstrapSystemSecretFromEnv(fallback, 'tavilyApiKeyEncrypted', 'TAVILY_API_KEY');
    console.log(`[ConfigService] Primary model: ${fallback.primaryModel} (from defaults)`);
    return fallback;
  }

  private saveConfig(): void {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Create a copy without sensitive data for logging/debugging
      const configToSave = JSON.parse(JSON.stringify(this.config));
      
      fs.writeFileSync(this.configPath, JSON.stringify(configToSave, null, 2), 'utf-8');
      console.log('[ConfigService] ✓ Config saved to', this.configPath);
    } catch (error) {
      console.error('[ConfigService] Failed to save config:', error);
      throw error;
    }
  }

  private syncProfilesFromDisk(): void {
    try {
      if (!fs.existsSync(this.configPath)) {
        return;
      }

      const data = fs.readFileSync(this.configPath, 'utf-8');
      const loaded = JSON.parse(data) as Partial<ModelsConfig>;

      if (loaded.assistantProfile) {
        this.config.assistantProfile = {
          ...this.config.assistantProfile,
          ...loaded.assistantProfile,
        };
      }

      if (loaded.userProfile) {
        this.config.userProfile = {
          ...this.config.userProfile,
          ...loaded.userProfile,
        };
      }
    } catch (error) {
      console.warn('[ConfigService] Failed to sync profile config from disk:', error);
    }
  }

  private syncConfigFromDisk(): void {
    try {
      if (!fs.existsSync(this.configPath)) {
        return;
      }
      const data = fs.readFileSync(this.configPath, 'utf-8');
      const loaded = JSON.parse(data) as Partial<ModelsConfig>;
      this.config = this.hydrateConfig(loaded);
    } catch (error) {
      console.warn('[ConfigService] Failed to sync full config from disk:', error);
    }
  }

  applySystemEnvironment(): void {
    this.syncConfigFromDisk();
    const system = this.config.system;
    process.env.OLLAMA_BASE_URL = system.ollamaBaseUrl;
    process.env.ANTHROPIC_MODEL = system.anthropicModel;
    process.env.PORT = system.port;
    process.env.ENZO_UI_PORT = system.uiPort;
    process.env.DB_PATH = system.dbPath;
    process.env.ENZO_WORKSPACE_PATH = system.enzoWorkspacePath;
    process.env.ENZO_SKILLS_PATH = system.enzoSkillsPath;
    process.env.ENZO_DEBUG = system.enzoDebug ? 'true' : 'false';
    process.env.ENZO_SKILLS_FALLBACK_RELEVANCE_THRESHOLD = String(system.enzoSkillsFallbackRelevanceThreshold);
    process.env.MCP_AUTO_CONNECT = system.mcpAutoConnect ? 'true' : 'false';
    process.env.DEFAULT_USER_LANGUAGE = system.defaultUserLanguage;
    process.env.TZ = system.tz;
    process.env.TELEGRAM_ALLOWED_USERS = system.telegramAllowedUsers;
    process.env.TELEGRAM_AGENT_OWNER_USER_ID = system.telegramAgentOwnerUserId;
    process.env.TELEGRAM_AGENT_AUTOROUTE = system.telegramAgentAutoroute ? 'true' : 'false';
    process.env.ENZO_MEMORY_CONFIDENCE_THRESHOLD = String(system.enzoMemoryConfidenceThreshold);
    process.env.ENZO_VERIFY_BEFORE_SYNTHESIS = system.enzoVerifyBeforeSynthesis ? 'true' : 'false';
    process.env.ENZO_SKILLS_FALLBACK_ALL_WHEN_NONE_ENABLED = system.enzoSkillsFallbackAllWhenNoneEnabled
      ? 'true'
      : 'false';
    process.env.ENZO_NATIVE_TOOL_CALLING = system.enzoNativeToolCalling ? 'true' : 'false';

    const telegramToken = this.getSystemSecret('telegramBotTokenEncrypted');
    if (telegramToken) {
      process.env.TELEGRAM_BOT_TOKEN = telegramToken;
    }
    const tavilyKey = this.getSystemSecret('tavilyApiKeyEncrypted');
    if (tavilyKey) {
      process.env.TAVILY_API_KEY = tavilyKey;
    }
  }

  // Model management

  getPrimaryModel(): string {
    this.syncConfigFromDisk();
    return this.config.primaryModel;
  }

  getPrimaryProvider(): string {
    this.syncConfigFromDisk();
    const explicit = this.config.primaryProvider?.trim();
    if (explicit) return explicit;
    const model = this.config.primaryModel || '';
    if (model.toLowerCase().includes('claude')) return 'anthropic';
    if (model.toLowerCase().includes('gemini')) return 'gemini';
    if (model.toLowerCase().startsWith('gpt') || model.toLowerCase().includes('openai')) return 'openai';
    return 'ollama';
  }

  getFallbackProvider(): string | undefined {
    this.syncConfigFromDisk();
    return this.config.fallbackProvider?.trim() || undefined;
  }

  getFallbackModel(): string | undefined {
    this.syncConfigFromDisk();
    return this.config.fallbackModel?.trim() || undefined;
  }

  setPrimaryModel(model: string): void {
    this.config.primaryModel = model;
    this.saveConfig();
    console.log('[ConfigService] Primary model set to:', model);
  }

  setPrimaryProvider(provider: string): void {
    this.config.primaryProvider = provider;
    this.saveConfig();
    console.log('[ConfigService] Primary provider set to:', provider);
  }

  getFallbackModels(): string[] {
    this.syncConfigFromDisk();
    return [...this.config.fallbackModels];
  }

  setFallbackModels(models: string[]): void {
    this.config.fallbackModels = [...models];
    this.saveConfig();
    console.log('[ConfigService] Fallback models set to:', models);
  }

  // Provider management

  getProviderConfig(provider: string): ProviderConfig | null {
    this.syncConfigFromDisk();
    return this.config.providers[provider] || null;
  }

  getAllProviders(): Record<string, ProviderConfig> {
    this.syncConfigFromDisk();
    // Return copies without encrypted keys
    const result: Record<string, ProviderConfig> = {};
    
    for (const [key, provider] of Object.entries(this.config.providers)) {
      result[key] = {
        name: provider.name,
        enabled: provider.enabled,
        hasApiKey: provider.hasApiKey,
        // Don't include apiKeyEncrypted in the response
      };
    }

    return result;
  }

  /**
   * Get decrypted API key for a provider
   * Should only be called by authorized code (backend)
   */
  getProviderApiKey(provider: string): string | null {
    this.syncConfigFromDisk();
    const config = this.config.providers[provider];
    if (!config || !config.apiKeyEncrypted) {
      return null;
    }

    try {
      return this.encryptionService.decrypt(config.apiKeyEncrypted);
    } catch (error) {
      console.error(`[ConfigService] Failed to decrypt API key for ${provider}:`, error);
      return null;
    }
  }

  /**
   * Set (encrypted) API key for a provider
   */
  setProviderApiKey(provider: string, apiKey: string): void {
    if (!this.config.providers[provider]) {
      this.config.providers[provider] = {
        name: provider,
        enabled: false,
        hasApiKey: false,
      };
    }

    const encrypted = this.encryptionService.encrypt(apiKey);
    this.config.providers[provider].apiKeyEncrypted = encrypted;
    this.config.providers[provider].hasApiKey = true;
    this.config.providers[provider].enabled = true;

    this.saveConfig();
    console.log(`[ConfigService] API key set for provider: ${provider}`);
  }

  /**
   * Enable/disable a provider
   */
  setProviderEnabled(provider: string, enabled: boolean): void {
    if (!this.config.providers[provider]) {
      this.config.providers[provider] = {
        name: provider,
        enabled: false,
        hasApiKey: false,
      };
    }

    this.config.providers[provider].enabled = enabled;
    this.saveConfig();
    console.log(`[ConfigService] Provider "${provider}" ${enabled ? 'enabled' : 'disabled'}`);
  }

  isProviderEnabled(provider: string): boolean {
    const config = this.config.providers[provider];
    return config ? config.enabled : false;
  }

  // Assistant and user profile management

  getAssistantProfile(): AssistantProfile {
    this.syncProfilesFromDisk();
    return { ...this.config.assistantProfile };
  }

  setAssistantProfile(profile: AssistantProfile): void {
    this.config.assistantProfile = {
      ...this.config.assistantProfile,
      ...profile,
    };
    this.saveConfig();
    console.log('[ConfigService] Assistant profile updated');
  }

  getUserProfile(): UserProfile {
    this.syncProfilesFromDisk();
    return { ...this.config.userProfile };
  }

  setUserProfile(profile: UserProfile): void {
    this.config.userProfile = {
      ...this.config.userProfile,
      ...profile,
    };
    this.saveConfig();
    console.log('[ConfigService] User profile updated');
  }

  // Get full config (without sensitive data)

  getSystemConfig(): SystemConfigView {
    this.syncConfigFromDisk();
    const system = this.config.system;
    return {
      ollamaBaseUrl: system.ollamaBaseUrl,
      anthropicModel: system.anthropicModel,
      port: system.port,
      uiPort: system.uiPort,
      dbPath: system.dbPath,
      enzoWorkspacePath: system.enzoWorkspacePath,
      enzoSkillsPath: system.enzoSkillsPath,
      enzoDebug: system.enzoDebug,
      enzoSkillsFallbackRelevanceThreshold: system.enzoSkillsFallbackRelevanceThreshold,
      mcpAutoConnect: system.mcpAutoConnect,
      enzoNativeToolCalling: !!system.enzoNativeToolCalling,
      defaultUserLanguage: system.defaultUserLanguage,
      tz: system.tz,
      telegramAllowedUsers: system.telegramAllowedUsers,
      telegramAgentOwnerUserId: system.telegramAgentOwnerUserId,
      telegramAgentAutoroute: !!system.telegramAgentAutoroute,
      hasTelegramBotToken: !!system.telegramBotTokenEncrypted,
      hasTavilyApiKey: !!system.tavilyApiKeyEncrypted,
      secretStoragePath: `${process.env.HOME || process.env.USERPROFILE || '~'}/.enzo/secret.key`,
    };
  }

  setSystemConfig(update: SystemConfigUpdate): void {
    this.syncConfigFromDisk();
    const current = this.config.system;
    this.config.system = {
      ...current,
      ...(update.ollamaBaseUrl !== undefined ? { ollamaBaseUrl: update.ollamaBaseUrl } : {}),
      ...(update.anthropicModel !== undefined ? { anthropicModel: update.anthropicModel } : {}),
      ...(update.port !== undefined ? { port: update.port } : {}),
      ...(update.uiPort !== undefined ? { uiPort: update.uiPort } : {}),
      ...(update.dbPath !== undefined ? { dbPath: update.dbPath } : {}),
      ...(update.enzoWorkspacePath !== undefined ? { enzoWorkspacePath: update.enzoWorkspacePath } : {}),
      ...(update.enzoSkillsPath !== undefined ? { enzoSkillsPath: update.enzoSkillsPath } : {}),
      ...(update.enzoDebug !== undefined ? { enzoDebug: update.enzoDebug } : {}),
      ...(update.enzoSkillsFallbackRelevanceThreshold !== undefined
        ? {
            enzoSkillsFallbackRelevanceThreshold: Number.isFinite(update.enzoSkillsFallbackRelevanceThreshold)
              ? Math.max(0, Math.min(1, update.enzoSkillsFallbackRelevanceThreshold))
              : current.enzoSkillsFallbackRelevanceThreshold,
          }
        : {}),
      ...(update.mcpAutoConnect !== undefined ? { mcpAutoConnect: update.mcpAutoConnect } : {}),
      ...(update.defaultUserLanguage !== undefined
        ? {
            defaultUserLanguage: SUPPORTED_LANGUAGES.includes(update.defaultUserLanguage as any)
              ? update.defaultUserLanguage
              : current.defaultUserLanguage,
          }
        : {}),
      ...(update.tz !== undefined ? { tz: update.tz } : {}),
      ...(update.telegramAllowedUsers !== undefined ? { telegramAllowedUsers: update.telegramAllowedUsers } : {}),
      ...(update.telegramAgentOwnerUserId !== undefined
        ? { telegramAgentOwnerUserId: update.telegramAgentOwnerUserId }
        : {}),
      ...(update.telegramAgentAutoroute !== undefined
        ? { telegramAgentAutoroute: update.telegramAgentAutoroute }
        : {}),
      ...(update.enzoMemoryConfidenceThreshold !== undefined
        ? {
            enzoMemoryConfidenceThreshold: Number.isFinite(update.enzoMemoryConfidenceThreshold)
              ? Math.max(0, Math.min(0.95, update.enzoMemoryConfidenceThreshold))
              : current.enzoMemoryConfidenceThreshold,
          }
        : {}),
      ...(update.enzoVerifyBeforeSynthesis !== undefined
        ? { enzoVerifyBeforeSynthesis: update.enzoVerifyBeforeSynthesis }
        : {}),
      ...(update.enzoSkillsFallbackAllWhenNoneEnabled !== undefined
        ? { enzoSkillsFallbackAllWhenNoneEnabled: update.enzoSkillsFallbackAllWhenNoneEnabled }
        : {}),
      ...(update.enzoNativeToolCalling !== undefined
        ? { enzoNativeToolCalling: update.enzoNativeToolCalling }
        : {}),
    };

    if (typeof update.telegramBotToken === 'string' && update.telegramBotToken.trim().length > 0) {
      this.config.system.telegramBotTokenEncrypted = this.encryptionService.encrypt(update.telegramBotToken.trim());
    }
    if (typeof update.tavilyApiKey === 'string' && update.tavilyApiKey.trim().length > 0) {
      this.config.system.tavilyApiKeyEncrypted = this.encryptionService.encrypt(update.tavilyApiKey.trim());
    }

    this.saveConfig();
    this.applySystemEnvironment();
  }

  getSystemSecret(field: 'telegramBotTokenEncrypted' | 'tavilyApiKeyEncrypted'): string | null {
    this.syncConfigFromDisk();
    const encryptedValue = this.config.system[field];
    if (!encryptedValue) {
      return null;
    }
    try {
      return this.encryptionService.decrypt(encryptedValue);
    } catch (error) {
      console.error(`[ConfigService] Failed to decrypt system secret "${field}":`, error);
      return null;
    }
  }

  getConfig(): ModelsConfig {
    this.syncConfigFromDisk();
    let copy: ModelsConfig;
    try {
      copy = JSON.parse(JSON.stringify(this.config)) as ModelsConfig;
    } catch (error) {
      console.error('[ConfigService] JSON clone failed — trying structuredClone:', error);
      try {
        copy = structuredClone(this.config);
      } catch (e2) {
        console.error('[ConfigService] structuredClone failed — using in-memory defaults:', e2);
        copy = structuredClone(getDefaultConfig());
      }
    }

    // Remove encrypted keys from copy
    for (const provider of Object.values(copy.providers)) {
      const p = provider as ProviderConfig;
      delete p.apiKeyEncrypted;
    }
    delete copy.system.telegramBotTokenEncrypted;
    delete copy.system.tavilyApiKeyEncrypted;

    return copy;
  }
}
