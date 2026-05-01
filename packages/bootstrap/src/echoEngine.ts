import https from 'node:https';
import {
  CalendarService,
  EchoEngine,
  NotificationGateway,
  Orchestrator,
  buildOrchestratorRuntimeHints,
  createMorningBriefingTask,
  createContextRefreshTask,
  createNightSummaryTask,
  EmailService,
  type AmplifierInput,
  type ConfigService,
  type MemoryService,
} from '@enzo/core';

let sharedEchoEngine: EchoEngine | null = null;
let echoNotificationGateway: NotificationGateway | null = null;

interface EchoEngineBindings {
  memoryService?: MemoryService;
  configService?: ConfigService;
  sendTelegramMessage?: (
    chatId: string,
    message: string,
    disableNotification: boolean
  ) => Promise<boolean>;
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

async function resolveTelegramChatId(memoryService: MemoryService, userId: string): Promise<string | undefined> {
  const memories = await memoryService.recall(userId, 'telegram_chat_id');
  return memories[0]?.value?.trim() || undefined;
}

export function createNotificationGateway(
  memoryService: MemoryService,
  telegramSender?: (chatId: string, message: string, disableNotification: boolean) => Promise<boolean>
): NotificationGateway {
  return new NotificationGateway({
    resolveChatId: async (userId) => resolveTelegramChatId(memoryService, userId),
    sendTelegram: async (chatId, message, disableNotification) => {
      if (telegramSender) {
        return telegramSender(chatId, message, disableNotification);
      }
      return notifyTelegram(chatId, message, disableNotification);
    },
    logger: console,
  });
}

export function getEchoNotificationGateway(): NotificationGateway | undefined {
  return echoNotificationGateway ?? undefined;
}

function buildEchoRuntimeHints(configService: ConfigService): Record<string, unknown> {
  const base = buildOrchestratorRuntimeHints();
  const profile = configService.getUserProfile();
  const systemTz = configService.getSystemConfig()?.tz?.trim();
  const lang = process.env.LANG || '';
  const timeLocale =
    profile?.locale?.trim() ||
    (lang.toLowerCase().includes('en_us') || lang.toLowerCase().startsWith('en') ? 'en-US' : 'es-CL');
  const tz = profile?.timezone?.trim() || systemTz;
  return {
    ...base,
    homeDir: process.env.HOME ?? base.homeDir,
    timeLocale,
    ...(tz ? { timeZone: tz } : {}),
  };
}

/** Tras crear `Orchestrator`, enlaza procesamiento para jobs declarativos `orchestrator_message`. */
export function bindEchoDeclarativeOrchestrator(options: {
  orchestrator: Orchestrator;
  memoryService: MemoryService;
  configService: ConfigService;
  notificationGateway?: Pick<NotificationGateway, 'notify'>;
}): void {
  const engine = getEchoEngine();
  const { orchestrator, memoryService, configService, notificationGateway } = options;
  engine.setOrchestratorBinding({
    process: (input) => orchestrator.process(input),
    memoryService,
    resolveEchoUserId: () => resolveEchoUserId(memoryService, configService),
    ...(notificationGateway ? { notificationGateway } : {}),
    buildRuntimeHints: () => buildEchoRuntimeHints(configService),
  });
}

export function getEchoEngine(bindings: EchoEngineBindings = {}): EchoEngine {
  if (!sharedEchoEngine) {
    sharedEchoEngine = new EchoEngine();
    const { memoryService, configService, sendTelegramMessage } = bindings;
    if (memoryService && configService) {
      const notificationGateway = createNotificationGateway(memoryService, sendTelegramMessage);
      echoNotificationGateway = notificationGateway;
      sharedEchoEngine.setDiagnosticsExtras(() => {
        const cfg = configService.getSystemConfig();
        const owner = Boolean(cfg.telegramAgentOwnerUserId?.trim());
        const allowed = Boolean((cfg.telegramAllowedUsers || '').trim());
        const duplicateEchoWarning =
          process.env.ENZO_DUAL_ECHO === 'true' || process.env.ENZO_DUAL_ECHO === '1'
            ? 'ENZO_DUAL_ECHO: pueden correr dos instancias (API + Telegram) y disparar los mismos cron dos veces.'
            : undefined;
        return {
          echoTargetUserConfigured: owner || allowed,
          duplicateEchoWarning,
        };
      });
      const resolveUserId = () => resolveEchoUserId(memoryService, configService);
      const emailService = new EmailService(configService);
      const calendarService = new CalendarService();
      sharedEchoEngine.registerTask(
        createMorningBriefingTask({
          memoryService,
          notificationGateway,
          resolveUserId,
          emailService,
          calendarService,
          buildRuntimeHints: () =>
            buildEchoRuntimeHints(configService) as NonNullable<AmplifierInput['runtimeHints']>,
        })
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
