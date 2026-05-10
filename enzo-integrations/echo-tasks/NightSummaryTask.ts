import type { EchoTask } from '../EchoEngine.js';
import type { Memory } from '../../memory/types.js';

const NIGHT_SUMMARY_SCHEDULE = '30 22 * * *';
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

interface MemoryAccess {
  recall(userId: string, key?: string): Promise<Memory[]>;
  remember(userId: string, key: string, value: string): Promise<void>;
}

export interface NightSummaryTaskOptions {
  memoryService: MemoryAccess;
  resolveUserId: () => Promise<string | undefined>;
  now?: () => Date;
  locale?: string;
}

function formatSummaryDate(now: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
}

export function createNightSummaryTask(options: NightSummaryTaskOptions): EchoTask {
  const nowProvider = options.now ?? (() => new Date());
  const locale = options.locale ?? 'es-AR';

  return {
    id: 'night-summary',
    name: 'Night Summary',
    schedule: NIGHT_SUMMARY_SCHEDULE,
    enabled: true,
    action: async () => {
      const userId = await options.resolveUserId();
      if (!userId) {
        return { success: false, error: 'No target user configured for NightSummary task' };
      }

      const now = nowProvider();
      const cutoff = now.getTime() - TWENTY_FOUR_HOURS_MS;
      const todayMemories = (await options.memoryService.recall(userId))
        .filter((memory) => memory.updatedAt >= cutoff && memory.value.trim().length > 0)
        .sort((a, b) => b.updatedAt - a.updatedAt);

      const entries = todayMemories.slice(0, 6).map((memory) => memory.value.trim());
      const summaryItems = entries.length > 0 ? entries.join(' | ') : 'sin novedades destacadas';
      const summaryDate = formatSummaryDate(now, locale);
      const summaryValue = `Resumen ${summaryDate}: ${summaryItems}`;
      await options.memoryService.remember(userId, 'other', summaryValue);

      return {
        success: true,
        notified: false,
        message: 'Night summary stored in memory',
      };
    },
  };
}
