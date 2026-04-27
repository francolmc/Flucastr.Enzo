import type { EchoTask } from '../EchoEngine.js';
import { ECHO_NOTIFICATION_PRIORITY, type NotificationGateway } from '../NotificationGateway.js';
import type { Memory } from '../../memory/types.js';

const MORNING_BRIEFING_SCHEDULE = '0 7 * * *';

interface MemoryReader {
  recall(userId: string, key?: string): Promise<Memory[]>;
}

export interface MorningBriefingTaskOptions {
  memoryService: MemoryReader;
  notificationGateway: NotificationGateway;
  resolveUserId: () => Promise<string | undefined>;
  now?: () => Date;
  locale?: string;
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
      const message = buildMorningBriefingMessage({
        now: nowProvider(),
        locale,
        memories,
      });

      const notified = await options.notificationGateway.notify({
        userId,
        message,
        priority: ECHO_NOTIFICATION_PRIORITY.URGENT,
      });

      return {
        success: notified,
        notified,
        message: notified ? 'Morning briefing sent' : 'Morning briefing skipped (unable to notify)',
      };
    },
  };
}
