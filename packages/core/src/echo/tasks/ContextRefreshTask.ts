import type { EchoTask } from '../EchoEngine.js';
import { ECHO_NOTIFICATION_PRIORITY, type NotificationGateway } from '../NotificationGateway.js';
import type { Memory } from '../../memory/types.js';

const CONTEXT_REFRESH_SCHEDULE = 'interval:120min';
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

interface MemoryReader {
  recall(userId: string, key?: string): Promise<Memory[]>;
}

export interface ContextRefreshTaskOptions {
  memoryService: MemoryReader;
  notificationGateway: NotificationGateway;
  resolveUserId: () => Promise<string | undefined>;
  now?: () => Date;
}

function isRecentUnprocessedCapture(memory: Memory, nowMs: number): boolean {
  if (nowMs - memory.updatedAt > TWO_HOURS_MS) {
    return false;
  }
  const value = memory.value.toLowerCase();
  const looksLikeCapture = value.includes('captura') || value.includes('capture');
  const unprocessed = value.includes('sin procesar') || value.includes('unprocessed') || value.includes('pendiente');
  return looksLikeCapture && unprocessed;
}

function projectLabel(value: string): string {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > 48 ? `${cleaned.slice(0, 45)}...` : cleaned;
}

export function createContextRefreshTask(options: ContextRefreshTaskOptions): EchoTask {
  const nowProvider = options.now ?? (() => new Date());

  return {
    id: 'context-refresh',
    name: 'Context Refresh',
    schedule: CONTEXT_REFRESH_SCHEDULE,
    enabled: true,
    action: async () => {
      const userId = await options.resolveUserId();
      if (!userId) {
        return { success: false, error: 'No target user configured for ContextRefresh task' };
      }

      const nowMs = nowProvider().getTime();
      const memories = await options.memoryService.recall(userId);
      const staleProject = memories
        .filter((memory) => memory.key === 'projects' && nowMs - memory.updatedAt > THREE_DAYS_MS)
        .sort((a, b) => a.updatedAt - b.updatedAt)[0];
      const hasRecentUnprocessedCapture = memories.some((memory) =>
        memory.key === 'other' ? isRecentUnprocessedCapture(memory, nowMs) : false
      );

      if (!staleProject && !hasRecentUnprocessedCapture) {
        return {
          success: true,
          notified: false,
          message: 'No relevant context refresh notifications',
        };
      }

      let notificationMessage = '[Proyecto] lleva 3 dias sin actividad. Queres que avance algo?';
      if (staleProject) {
        notificationMessage = `[${projectLabel(staleProject.value)}] lleva 3 dias sin actividad. Queres que avance algo?`;
      } else if (hasRecentUnprocessedCapture) {
        notificationMessage = 'Tenes capturas recientes sin procesar. Queres que las ordene?';
      }

      const notified = await options.notificationGateway.notify({
        userId,
        message: notificationMessage,
        priority: ECHO_NOTIFICATION_PRIORITY.NORMAL,
      });

      return {
        success: notified,
        notified,
        message: notified ? 'Context refresh notification sent' : 'Context refresh notification failed',
      };
    },
  };
}
