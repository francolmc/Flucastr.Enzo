import path from 'path';
import fs from 'fs';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { Telegraf } from 'telegraf';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '../../..');

function resolveSharedPath(configValue: string | undefined, fallbackAbsolutePath: string): string {
  if (!configValue || configValue.trim().length === 0) {
    return fallbackAbsolutePath;
  }

  const normalized = configValue.replace(/^~(?=$|\/|\\)/, homedir());
  if (path.isAbsolute(normalized)) {
    return normalized;
  }

  return path.resolve(workspaceRoot, normalized);
}

import {
  OllamaProvider,
  AnthropicProvider,
  MemoryService,
  Orchestrator,
  SkillRegistry,
  ConfigService,
  EncryptionService,
  ensureLocalSecret,
  WhisperTranscriptionService,
  EdgeTTSService,
} from '@enzo/core';
import { createDefaultToolRegistry, getEchoEngine, createNotificationGateway, createAgentRouter } from '@enzo/bootstrap';
import { createBot } from './bot.js';
import type { EnzoContext } from './bot.js';
import { registerCommands } from './handlers/commands.js';
import { registerMessageHandler } from './handlers/message.js';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isGetUpdatesConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const maybe = error as { response?: { error_code?: number; description?: string } };
  return (
    maybe.response?.error_code === 409 ||
    String(maybe.response?.description || '').includes('terminated by other getUpdates request')
  );
}

async function main() {
  try {
    const enzoSecret = ensureLocalSecret();
    const encryptionService = new EncryptionService(enzoSecret);
    const configService = new ConfigService(encryptionService);
    const systemConfig = configService.getSystemConfig();

    const allowedUsers = systemConfig.telegramAllowedUsers;
    process.env.TELEGRAM_ALLOWED_USERS = allowedUsers;
    process.env.TELEGRAM_AGENT_OWNER_USER_ID = systemConfig.telegramAgentOwnerUserId || '';

    if (!allowedUsers) {
      console.warn(
        '[Telegram] TELEGRAM_ALLOWED_USERS not set - no users will be allowed access'
      );
    } else {
      const userIds = allowedUsers.split(',').map(id => id.trim());
      console.log(`[Telegram] Allowed users: ${userIds.join(', ')}`);
    }

    console.log('[Telegram] Initializing Enzo bot...');

    const dbPath = resolveSharedPath(systemConfig.dbPath, path.join(homedir(), '.enzo', 'enzo.db'));
    const skillsPath = resolveSharedPath(systemConfig.enzoSkillsPath, path.join(homedir(), '.enzo', 'skills'));
    process.env.ENZO_SKILLS_PATH = skillsPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.mkdirSync(skillsPath, { recursive: true });
    const memoryService = new MemoryService(dbPath);
    console.log(`[Telegram] MemoryService initialized (${dbPath})`);
    console.log(`[Telegram] Shared skills path: ${skillsPath}`);

    const skillRegistry = new SkillRegistry(undefined, memoryService);
    await skillRegistry.reload();
    skillRegistry.startWatching();
    console.log('[Telegram] SkillRegistry initialized and loaded');

    const ollamaBaseUrl =
      systemConfig.ollamaBaseUrl || 'http://localhost:11434';
    const ollamaPrimaryModel = configService.getPrimaryModel() || 'qwen2.5:7b';
    const ollamaProvider = new OllamaProvider(ollamaBaseUrl, ollamaPrimaryModel);
    console.log(`[Telegram] OllamaProvider initialized (${ollamaPrimaryModel})`);

    let anthropicProvider: AnthropicProvider | undefined;
    const anthropicApiKey = configService.getProviderApiKey('anthropic');
    if (anthropicApiKey) {
      const anthropicModel = systemConfig.anthropicModel || 'claude-haiku-4-5';
      anthropicProvider = new AnthropicProvider(
        anthropicApiKey,
        anthropicModel
      );
      console.log('[Telegram] AnthropicProvider initialized');
    }

    let bot: Telegraf<EnzoContext> | null = null;
    const sendTelegramMessage = async (
      chatId: string,
      message: string,
      disableNotification: boolean
    ): Promise<boolean> => {
      if (!bot) {
        return false;
      }
      try {
        await bot.telegram.sendMessage(chatId, message, {
          disable_notification: disableNotification,
        });
        return true;
      } catch (error) {
        console.error('[Telegram] Failed to send push notification:', error);
        return false;
      }
    };

    const toolRegistry = createDefaultToolRegistry(memoryService, workspaceRoot, configService);
    const echoEngine = getEchoEngine({ memoryService, configService, sendTelegramMessage });
    echoEngine.start();
    const transcriptionService = new WhisperTranscriptionService(configService);
    const ttsService = new EdgeTTSService({ configService });
    const agentNotificationGateway = createNotificationGateway(memoryService, sendTelegramMessage);
    const agentRouter = createAgentRouter(configService, memoryService, agentNotificationGateway, workspaceRoot);
    const orchestrator = new Orchestrator(
      ollamaProvider,
      anthropicProvider,
      memoryService,
      { skillRegistry, configService, toolRegistry, agentRouter }
    );
    console.log('[Telegram] Orchestrator initialized');

    let configPoller: NodeJS.Timeout | null = null;
    let isReloading = false;
    let currentSignature = '';

    const buildSignature = (): string => {
      const token = configService.getSystemSecret('telegramBotTokenEncrypted') || '';
      const cfg = configService.getSystemConfig();
      return `${token}|${cfg.telegramAllowedUsers || ''}|${cfg.telegramAgentOwnerUserId || ''}|${cfg.telegramAgentAutoroute ? '1' : '0'}`;
    };

    const applyTelegramEnvFromConfig = (): { token: string; allowedUsers: string; ownerUserId: string } => {
      configService.applySystemEnvironment();
      const token = configService.getSystemSecret('telegramBotTokenEncrypted') || '';
      const cfg = configService.getSystemConfig();
      const allowedUsersValue = cfg.telegramAllowedUsers || '';
      const ownerUserId = cfg.telegramAgentOwnerUserId || '';
      process.env.TELEGRAM_BOT_TOKEN = token;
      process.env.TELEGRAM_ALLOWED_USERS = allowedUsersValue;
      process.env.TELEGRAM_AGENT_OWNER_USER_ID = ownerUserId;
      return { token, allowedUsers: allowedUsersValue, ownerUserId };
    };

    const launchBot = async (reason: string): Promise<boolean> => {
      const { token } = applyTelegramEnvFromConfig();
      if (!token) {
        console.warn('[Telegram] Bot token missing in config, waiting for update...');
        if (bot) {
          bot.stop('token_missing');
          bot = null;
        }
        currentSignature = buildSignature();
        return false;
      }

      if (bot) {
        console.log(`[Telegram] Reloading bot (${reason})...`);
        bot.stop('reload');
        bot = null;
      }

      const nextBot = createBot(orchestrator, memoryService, { configService, transcriptionService, ttsService });
      registerCommands(nextBot);
      registerMessageHandler(nextBot);
      const maxAttempts = 20;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await nextBot.launch({ dropPendingUpdates: true });
          break;
        } catch (error) {
          if (!isGetUpdatesConflict(error) || attempt === maxAttempts) {
            throw error;
          }
          const waitMs = Math.min(2000 * attempt, 15000);
          console.warn(
            `[Telegram] getUpdates conflict on launch (${attempt}/${maxAttempts}). Retrying in ${waitMs}ms...`
          );
          try {
            nextBot.stop('launch_conflict_retry');
          } catch {
            // ignore - bot may not be fully started yet
          }
          await delay(waitMs);
        }
      }
      bot = nextBot;
      currentSignature = buildSignature();
      console.log(`[Telegram] Bot active (${reason})`);
      return true;
    };

    await launchBot('initial');

    configPoller = setInterval(async () => {
      if (isReloading) return;
      const nextSignature = buildSignature();
      if (nextSignature === currentSignature) return;
      isReloading = true;
      try {
        await launchBot('config change');
      } catch (error) {
        console.error('[Telegram] Hot-reload failed:', error);
      } finally {
        isReloading = false;
      }
    }, 5000);

    const shutdown = (signal: string) => {
      console.log(`[Telegram] ${signal} received, stopping bot...`);
      skillRegistry.stopWatching();
      echoEngine.stop();
      if (configPoller) {
        clearInterval(configPoller);
        configPoller = null;
      }
      if (bot) {
        bot.stop(signal);
      }
    };

    process.once('SIGINT', () => {
      shutdown('SIGINT');
    });

    process.once('SIGTERM', () => {
      shutdown('SIGTERM');
    });

    console.log('🦊 Enzo Telegram activo');

  } catch (error) {
    console.error('[Telegram] Fatal error:', error);
    process.exit(1);
  }
}

main();
