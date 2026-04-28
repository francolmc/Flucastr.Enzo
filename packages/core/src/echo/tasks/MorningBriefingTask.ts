import type { EchoTask } from '../EchoEngine.js';
import type { NotificationGateway } from '../NotificationGateway.js';
import type { Memory } from '../../memory/types.js';
import type { EmailService } from '../../email/EmailService.js';

const MORNING_BRIEFING_SCHEDULE = '0 7 * * *';

interface MemoryReader {
  recall(userId: string, key?: string): Promise<Memory[]>;
}

export interface MorningBriefingTaskOptions {
  memoryService: MemoryReader;
  notificationGateway: Pick<NotificationGateway, 'notify'>;
  resolveUserId: () => Promise<string | undefined>;
  now?: () => Date;
  locale?: string;
  emailService?: EmailService;
}

function formatDate(now: Date, locale: string): { weekday: string; date: string } {
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(now);
  const date = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
  return { weekday, date };
}

function getTopPendingItems(memories: Memory[], maxItems: number): string[] {
  return memories
    .filter((memory) => (memory.key === 'projects' || memory.key === 'other') && memory.value.trim().length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, maxItems)
    .map((memory) => `- ${memory.value.trim()}`);
}

export function buildMorningBriefingMessage(params: {
  now: Date;
  locale: string;
  memories: Memory[];
}): string {
  const { now, locale, memories } = params;
  const { weekday, date } = formatDate(now, locale);
  const hasClassToday = now.getDay() >= 1 && now.getDay() <= 5;
  const pendingItems = getTopPendingItems(memories, 3);
  const lines: string[] = [
    'Buenos dias Franco ☀️',
    '',
    `Hoy es ${weekday}, ${date}.`,
    '',
    '📋 Pendientes:',
    ...(pendingItems.length > 0 ? pendingItems : ['- Sin pendientes destacados.']),
    '',
  ];

  if (hasClassToday) {
    lines.push('🎓 Clase hoy a las 19h — revisa que das.', '');
  }

  lines.push('💡 Captura algo antes de arrancar el dia.');
  return lines.join('\n');
}

export function createMorningBriefingTask(options: MorningBriefingTaskOptions): EchoTask {
  const nowProvider = options.now ?? (() => new Date());
  const locale = options.locale ?? 'es-AR';

  return {
    id: 'morning-briefing',
    name: 'Morning Briefing',
    schedule: MORNING_BRIEFING_SCHEDULE,
    enabled: true,
    action: async () => {
      const userId = await options.resolveUserId();
      if (!userId) {
        return { success: false, error: 'No target user configured for MorningBriefing task' };
      }

      const memories = await options.memoryService.recall(userId);
      let message = buildMorningBriefingMessage({
        now: nowProvider(),
        locale,
        memories,
      });

      if (options.emailService?.getConfiguredAccounts?.().length) {
        const yesterday = new Date(nowProvider().getTime() - 24 * 60 * 60 * 1000);
        const emailResult = await options.emailService.getRecent({
          limit: 5,
          since: yesterday,
        });
        if (emailResult.success && emailResult.messages?.length) {
          const msgs = emailResult.messages;
          message += `\n\n📧 Correos recientes (${msgs.length}):\n`;
          msgs.slice(0, 3).forEach((msg) => {
            message += `• ${msg.from}: ${msg.subject}\n`;
          });
          if (msgs.length > 3) {
            message += `  ...y ${msgs.length - 3} más\n`;
          }
        } else if (emailResult.success && (!emailResult.messages || emailResult.messages.length === 0)) {
          message += '\n\n📧 Sin emails nuevos en las últimas 24h\n';
        }
      }

      await options.notificationGateway.notify(userId, message, {
        priority: 'URGENT',
        deduplicationKey: `morning-briefing-${nowProvider().toISOString().slice(0, 10)}`,
      });

      return {
        success: true,
        notified: true,
        message: 'Morning briefing notification processed',
      };
    },
  };
}
