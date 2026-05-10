import path from 'path';
import fs from 'fs';
import { mkdirSync, existsSync, lstatSync } from 'fs';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { Telegraf } from 'telegraf';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '../../..');

function normalizeConfiguredPath(configValue: string | undefined, fallbackAbsolutePath: string): string {
  if (!configValue || !configValue.trim()) {
    return fallbackAbsolutePath;
  }
  const trimmed = configValue.trim();
  if (trimmed === '~') {
    return homedir();
  }
  if (trimmed.startsWith('~/')) {
    return path.join(homedir(), trimmed.slice(2));
  }
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }
  return path.resolve(homedir(), trimmed);
}

function resolveSharedDirPath(configValue: string | undefined, fallbackAbsolutePath: string): string {
  let resolved = normalizeConfiguredPath(configValue, fallbackAbsolutePath);
  if (!existsSync(resolved)) {
    try {
      mkdirSync(resolved, { recursive: true });
      console.log(`[Config] Created missing directory: ${resolved}`);
    } catch (err) {
      console.warn(`[Config] Could not create directory ${resolved}:`, err);
      resolved = fallbackAbsolutePath;
      mkdirSync(resolved, { recursive: true });
    }
  } else if (!lstatSync(resolved).isDirectory()) {
    console.warn(`[Config] Expected a directory path but got file: ${resolved}. Using fallback: ${fallbackAbsolutePath}`);
    resolved = fallbackAbsolutePath;
    mkdirSync(resolved, { recursive: true });
  }
  return resolved;
}

function resolveSharedFilePath(configValue: string | undefined, fallbackAbsolutePath: string): string {
  let resolved = normalizeConfiguredPath(configValue, fallbackAbsolutePath);
  if (existsSync(resolved) && lstatSync(resolved).isDirectory()) {
    console.warn(`[Config] Expected a file path but got directory: ${resolved}. Using fallback: ${fallbackAbsolutePath}`);
    resolved = fallbackAbsolutePath;
  }
  mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

import {
  ConfigService,
  EncryptionService,
  ensureLocalSecret,
} from '@enzo/core';
import { createBot } from './bot.js';
import type { EnzoContext } from './bot.js';
import { registerCommands } from './handlers/commands.js';
import { registerMessageHandler } from './handlers/message.js';
import { createTelegramApiClient } from './apiClient.js';

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

    console.log('[Telegram] Initializing Enzo bot (SDK mode)...');

    // SDK Mode: Only ConfigService is needed locally for Telegram settings
    // All other services (Memory, Orchestrator, etc.) are accessed via API
    
    process.env.ENZO_RUNTIME_ROLE = process.env.ENZO_RUNTIME_ROLE?.trim() || 'telegram';

    // Initialize API Client for SDK-based communication (PRIMARY MODE)
    const apiClient = createTelegramApiClient();
    console.log('[Telegram] API Client initialized (SDK mode)');

    let configPoller: NodeJS.Timeout | null = null;
    let isReloading = false;
    let currentSignature = '';
    let bot: Telegraf<EnzoContext> | null = null;

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

      const nextBot = createBot(null, null, {
        configService,
        apiClient,
      });
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
