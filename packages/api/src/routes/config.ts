import { Router, Request, Response } from 'express';
import { ConfigService, ModelsConfig, ProviderConfig, AssistantProfile, UserProfile, SystemConfigUpdate, SystemConfigView, DailyRoutineConfig, DailyRoutineConfigUpdate } from '@enzo/core';
import { EncryptionService } from '@enzo/core';

interface OllamaModel {
  name: string;
  size?: number;
  modified?: string;
}

interface OllamaTagsResponse {
  models: Array<OllamaModel>;
}

interface ModelsConfigResponse {
  primaryModel: string;
  runtimeModelSource: 'config';
  runtimeModelRequiresRestart: boolean;
  fallbackModels: string[];
  availableOllamaModels: OllamaModel[];
  availableProviders: Array<{
    name: string;
    enabled: boolean;
    hasApiKey: boolean;
  }>;
}

interface ProfilesConfigResponse {
  assistantProfile: AssistantProfile;
  userProfile: UserProfile;
}

interface SystemConfigResponse {
  system: SystemConfigView;
}

async function getOllamaModels(baseUrl: string): Promise<OllamaModel[]> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as OllamaTagsResponse;
    return data.models || [];
  } catch (error) {
    console.warn('[getOllamaModels] Failed to fetch Ollama models:', error);
    return [];
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export function createConfigRouter(
  configService?: ConfigService,
  encryptionService?: EncryptionService
): Router {
  const router = Router();

  // Initialize services if not provided
  const encryption = encryptionService || new EncryptionService(process.env.ENZO_SECRET || '');
  const config = configService || new ConfigService(encryption);

  /**
   * GET /api/config/models
   * Get current model and provider configuration
   */
  router.get('/api/config/models', async (req: Request, res: Response) => {
    try {
      const ollamaBaseUrl = config.getSystemConfig().ollamaBaseUrl || 'http://localhost:11434';
      const ollamaModels = await getOllamaModels(ollamaBaseUrl);
      const cfg = config.getConfig();
      const providers = config.getAllProviders();

      const response: ModelsConfigResponse = {
        primaryModel: cfg.primaryModel,
        runtimeModelSource: 'config',
        runtimeModelRequiresRestart: false,
        fallbackModels: cfg.fallbackModels,
        availableOllamaModels: ollamaModels,
        availableProviders: Object.entries(providers).map(([key, provider]) => ({
          name: provider.name,
          enabled: provider.enabled,
          hasApiKey: provider.hasApiKey,
        })),
      };

      res.json(response);
    } catch (error) {
      console.error('[GET /api/config/models] error:', error);
      res.status(500).json({
        error: 'ConfigError',
        message: error instanceof Error ? error.message : 'Failed to retrieve config',
        statusCode: 500,
      });
    }
  });

  /**
   * PUT /api/config/models
   * Update primary and fallback models
   */
  router.put('/api/config/models', async (req: Request, res: Response) => {
    try {
      const { primaryModel, fallbackModels } = req.body;

      if (!primaryModel || typeof primaryModel !== 'string') {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Field "primaryModel" is required and must be a string',
          statusCode: 400,
        });
        return;
      }

      // Validate that primary model exists in Ollama
      const ollamaBaseUrl = config.getSystemConfig().ollamaBaseUrl || 'http://localhost:11434';
      const ollamaModels = await getOllamaModels(ollamaBaseUrl);
      const modelNames = ollamaModels.map(m => m.name);

      if (!modelNames.includes(primaryModel)) {
        res.status(400).json({
          error: 'ValidationError',
          message: `Model "${primaryModel}" not found in Ollama`,
          statusCode: 400,
        });
        return;
      }

      config.setPrimaryModel(primaryModel);
      if (Array.isArray(fallbackModels)) {
        config.setFallbackModels(fallbackModels);
      }

      res.json({
        success: true,
        message: `Primary model updated to "${primaryModel}" from config.json`,
      });
    } catch (error) {
      console.error('[PUT /api/config/models] error:', error);
      res.status(500).json({
        error: 'ConfigError',
        message: error instanceof Error ? error.message : 'Failed to update config',
        statusCode: 500,
      });
    }
  });

  /**
   * PUT /api/config/providers/:provider/apikey
   * Set encrypted API key for a provider
   */
  router.put('/api/config/providers/:provider/apikey', async (req: Request, res: Response) => {
    try {
      const { provider } = req.params;
      const { apiKey } = req.body;

      if (!apiKey || typeof apiKey !== 'string') {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Field "apiKey" is required and must be a string',
          statusCode: 400,
        });
        return;
      }

      // Save encrypted API key
      config.setProviderApiKey(provider, apiKey);

      res.json({ success: true });
    } catch (error) {
      console.error('[PUT /api/config/providers/:provider/apikey] error:', error);
      res.status(500).json({
        error: 'ConfigError',
        message: error instanceof Error ? error.message : 'Failed to save API key',
        statusCode: 500,
      });
    }
  });

  /**
   * PUT /api/config/providers/:provider/enabled
   * Enable or disable a provider
   */
  router.put('/api/config/providers/:provider/enabled', async (req: Request, res: Response) => {
    try {
      const { provider } = req.params;
      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Field "enabled" is required and must be a boolean',
          statusCode: 400,
        });
        return;
      }

      config.setProviderEnabled(provider, enabled);

      res.json({ success: true });
    } catch (error) {
      console.error('[PUT /api/config/providers/:provider/enabled] error:', error);
      res.status(500).json({
        error: 'ConfigError',
        message: error instanceof Error ? error.message : 'Failed to update provider status',
        statusCode: 500,
      });
    }
  });

  /**
   * GET /api/config/system
   * Get runtime/system settings from config.json
   */
  router.get('/api/config/system', async (req: Request, res: Response) => {
    try {
      const response: SystemConfigResponse = {
        system: config.getSystemConfig(),
      };
      res.json(response);
    } catch (error) {
      console.error('[GET /api/config/system] error:', error);
      res.status(500).json({
        error: 'ConfigError',
        message: error instanceof Error ? error.message : 'Failed to retrieve system config',
        statusCode: 500,
      });
    }
  });

  /**
   * PUT /api/config/system
   * Update runtime/system settings in config.json
   */
  router.put('/api/config/system', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as SystemConfigUpdate;
      config.setSystemConfig(body);
      res.json({
        success: true,
        system: config.getSystemConfig(),
      });
    } catch (error) {
      console.error('[PUT /api/config/system] error:', error);
      res.status(500).json({
        error: 'ConfigError',
        message: error instanceof Error ? error.message : 'Failed to update system config',
        statusCode: 500,
      });
    }
  });

  /**
   * GET /api/config/profiles
   * Get assistant and user profile configuration
   */
  router.get('/api/config/profiles', async (req: Request, res: Response) => {
    try {
      const response: ProfilesConfigResponse = {
        assistantProfile: config.getAssistantProfile(),
        userProfile: config.getUserProfile(),
      };
      res.json(response);
    } catch (error) {
      console.error('[GET /api/config/profiles] error:', error);
      res.status(500).json({
        error: 'ConfigError',
        message: error instanceof Error ? error.message : 'Failed to retrieve profiles config',
        statusCode: 500,
      });
    }
  });

  /**
   * PUT /api/config/profiles
   * Update assistant and/or user profile configuration
   */
  router.put('/api/config/profiles', async (req: Request, res: Response) => {
    try {
      const { assistantProfile, userProfile } = req.body as {
        assistantProfile?: AssistantProfile;
        userProfile?: UserProfile;
      };

      if (!assistantProfile && !userProfile) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'At least one of "assistantProfile" or "userProfile" must be provided',
          statusCode: 400,
        });
        return;
      }

      if (assistantProfile) {
        if (typeof assistantProfile.name !== 'string' || !assistantProfile.name.trim()) {
          res.status(400).json({
            error: 'ValidationError',
            message: 'Field "assistantProfile.name" is required and must be a non-empty string',
            statusCode: 400,
          });
          return;
        }

        config.setAssistantProfile({
          name: assistantProfile.name.trim(),
          persona: assistantProfile.persona?.trim() || '',
          tone: assistantProfile.tone?.trim() || '',
          styleGuidelines: assistantProfile.styleGuidelines?.trim() || '',
        });
      }

      if (userProfile) {
        config.setUserProfile({
          displayName: userProfile.displayName?.trim() || '',
          importantInfo: userProfile.importantInfo?.trim() || '',
          preferences: userProfile.preferences?.trim() || '',
          locale: userProfile.locale?.trim() || '',
          timezone: userProfile.timezone?.trim() || '',
        });
      }

      res.json({
        success: true,
        assistantProfile: config.getAssistantProfile(),
        userProfile: config.getUserProfile(),
      });
    } catch (error) {
      console.error('[PUT /api/config/profiles] error:', error);
      res.status(500).json({
        error: 'ConfigError',
        message: error instanceof Error ? error.message : 'Failed to update profiles config',
        statusCode: 500,
      });
    }
  });

  // Legacy endpoint for backwards compatibility
  router.get('/api/config', async (req: Request, res: Response) => {
    try {
      const primaryModel = config.getPrimaryModel();
      const ollamaBaseUrl = config.getSystemConfig().ollamaBaseUrl || 'http://localhost:11434';

      const system = config.getSystemConfig();
      const availableProviders = Object.values(config.getAllProviders())
        .filter((provider) => provider.enabled)
        .map((provider) => provider.name);

      const ollamaModels = await getOllamaModels(ollamaBaseUrl);

      const response = {
        primaryModel,
        availableProviders,
        ollamaModels: ollamaModels.map(m => m.name),
        assistantProfile: config.getAssistantProfile(),
        userProfile: config.getUserProfile(),
        systemConfig: system,
      };

      res.json(response);
    } catch (error) {
      console.error('[GET /api/config] error:', error);
      res.status(500).json({
        error: 'ConfigError',
        message: error instanceof Error ? error.message : 'Failed to retrieve config',
        statusCode: 500,
      });
    }
  });

  router.post('/api/config/test-provider', async (req: Request, res: Response) => {
    try {
      const { provider } = req.body;

      if (!provider || typeof provider !== 'string') {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Field "provider" is required and must be a string',
          statusCode: 400,
        });
        return;
      }

      let available = false;
      let latencyMs = 0;
      const startedAt = Date.now();

      if (provider === 'ollama') {
        const ollamaBaseUrl = config.getSystemConfig().ollamaBaseUrl || 'http://localhost:11434';
        try {
          const response = await fetchWithTimeout(`${ollamaBaseUrl}/api/tags`);
          latencyMs = Date.now() - startedAt;
          available = response.ok;
        } catch (error) {
          latencyMs = Date.now() - startedAt;
          available = false;
        }
      } else if (provider === 'anthropic') {
        const apiKey = config.getProviderApiKey('anthropic');
        if (apiKey) {
          try {
            const response = await fetchWithTimeout('https://api.anthropic.com/v1/models', {
              headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
              },
            });
            available = response.ok;
          } catch {
            available = false;
          }
        }
        latencyMs = Date.now() - startedAt;
      } else if (provider === 'openai') {
        const apiKey = config.getProviderApiKey('openai');
        if (apiKey) {
          try {
            const response = await fetchWithTimeout('https://api.openai.com/v1/models', {
              headers: {
                Authorization: `Bearer ${apiKey}`,
              },
            });
            available = response.ok;
          } catch {
            available = false;
          }
        }
        latencyMs = Date.now() - startedAt;
      } else if (provider === 'gemini') {
        const apiKey = config.getProviderApiKey('gemini');
        if (apiKey) {
          try {
            const response = await fetchWithTimeout(
              `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
            );
            available = response.ok;
          } catch {
            available = false;
          }
        }
        latencyMs = Date.now() - startedAt;
      } else {
        res.status(400).json({
          error: 'ValidationError',
          message: `Provider "${provider}" is not supported`,
          statusCode: 400,
        });
        return;
      }

      res.json({
        available,
        latencyMs,
      });
    } catch (error) {
      console.error('[POST /api/config/test-provider] error:', error);
      res.status(500).json({
        error: 'TestError',
        message: error instanceof Error ? error.message : 'Failed to test provider',
        statusCode: 500,
      });
    }
  });

  /**
   * GET /api/config/daily-routine
   * Get daily routine notification settings
   */
  router.get('/api/config/daily-routine', async (req: Request, res: Response) => {
    try {
      const dailyRoutine = config.getDailyRoutineConfig();
      res.json({
        success: true,
        dailyRoutine,
      });
    } catch (error) {
      console.error('[GET /api/config/daily-routine] error:', error);
      res.status(500).json({
        error: 'ConfigError',
        message: error instanceof Error ? error.message : 'Failed to retrieve daily routine config',
        statusCode: 500,
      });
    }
  });

  /**
   * PUT /api/config/daily-routine
   * Update daily routine notification settings
   */
  router.put('/api/config/daily-routine', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        morningBriefing?: { time?: string; enabled?: boolean };
        middayCheckin?: { time?: string; enabled?: boolean };
        afternoonPrep?: { time?: string; enabled?: boolean };
        eveningRecap?: { time?: string; enabled?: boolean };
      };

      config.setDailyRoutineConfig(body);
      res.json({
        success: true,
        dailyRoutine: config.getDailyRoutineConfig(),
      });
    } catch (error) {
      console.error('[PUT /api/config/daily-routine] error:', error);
      res.status(500).json({
        error: 'ConfigError',
        message: error instanceof Error ? error.message : 'Failed to update daily routine config',
        statusCode: 500,
      });
    }
  });

  return router;
}
