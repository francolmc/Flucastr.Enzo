import https from 'node:https';
import {
  EchoEngine,
  ECHO_NOTIFICATION_PRIORITY,
  createMorningBriefingTask,
  createContextRefreshTask,
  createNightSummaryTask,
  type ConfigService,
  type MemoryService,
  type NotificationGateway,
} from '@enzo/core';

let sharedEchoEngine: EchoEngine | null = null;

interface EchoEngineBindings {
  memoryService?: MemoryService;
  configService?: ConfigService;
}

function notifyTelegram(chatId: string, text: string, disableNotification: boolean): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return Promise.resolve(false);
  }

  const payload = JSON.stringify({
    chat_id: chatId,
    text,
    disable_notification: disableNotification,
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${token}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const ok = res.statusCode != null && res.statusCode >= 200 && res.statusCode < 300;
        resolve(ok);
      }
    );
    req.on('error', () => resolve(false));
    req.write(payload);
    req.end();
  });
}

async function resolveEchoUserId(memoryService: MemoryService, configService: ConfigService): Promise<string | undefined> {
  const cfg = configService.getSystemConfig();
  const ownerUserId = cfg.telegramAgentOwnerUserId?.trim();
  if (ownerUserId) {
    return ownerUserId;
  }

  const allowedUsers = (cfg.telegramAllowedUsers || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (allowedUsers.length === 0) {
    return undefined;
  }

  let latestUserId: string | undefined;
  let latestActivity = Number.NEGATIVE_INFINITY;
  for (const userId of allowedUsers) {
    const conversations = await memoryService.getConversations(userId, 1);
    const updatedAt = conversations[0]?.updatedAt ?? Number.NEGATIVE_INFINITY;
    if (updatedAt > latestActivity) {
      latestActivity = updatedAt;
      latestUserId = userId;
    }
  }

  return latestUserId ?? allowedUsers[0];
}

class TelegramNotificationGateway implements NotificationGateway {
  async notify(params: { userId: string; message: string; priority: 'URGENT' | 'NORMAL' }): Promise<boolean> {
    const disableNotification = params.priority !== ECHO_NOTIFICATION_PRIORITY.URGENT;
    return notifyTelegram(params.userId, params.message, disableNotification);
  }
}

export function getEchoEngine(bindings: EchoEngineBindings = {}): EchoEngine {
  if (!sharedEchoEngine) {
    sharedEchoEngine = new EchoEngine();
    const { memoryService, configService } = bindings;
    if (memoryService && configService) {
      const notificationGateway = new TelegramNotificationGateway();
      const resolveUserId = () => resolveEchoUserId(memoryService, configService);
      sharedEchoEngine.registerTask(
        createMorningBriefingTask({ memoryService, notificationGateway, resolveUserId })
      );
      sharedEchoEngine.registerTask(
        createContextRefreshTask({ memoryService, notificationGateway, resolveUserId })
      );
      sharedEchoEngine.registerTask(createNightSummaryTask({ memoryService, resolveUserId }));
    } else {
      sharedEchoEngine.registerTask({
        id: 'morning-briefing',
        name: 'Morning Briefing',
        schedule: '0 7 * * *',
        enabled: true,
        action: async () => ({ success: false, error: 'Echo tasks are not configured yet' }),
      });
      sharedEchoEngine.registerTask({
        id: 'context-refresh',
        name: 'Context Refresh',
        schedule: 'interval:120min',
        enabled: true,
        action: async () => ({ success: false, error: 'Echo tasks are not configured yet' }),
      });
      sharedEchoEngine.registerTask({
        id: 'night-summary',
        name: 'Night Summary',
        schedule: '30 22 * * *',
        enabled: true,
        action: async () => ({ success: false, error: 'Echo tasks are not configured yet' }),
      });
    }
  }
  return sharedEchoEngine;
}
