const DEDUP_WINDOW_MS = 4 * 60 * 60 * 1000;
const SILENCE_START_HOUR = 23;
const SILENCE_END_HOUR = 7;
const NORMAL_LIMIT_PER_HOUR = 3;

export type NotificationPriority = 'URGENT' | 'NORMAL' | 'LOW';
export type NotificationChannel = 'telegram' | 'log';

export interface NotificationOptions {
  priority: NotificationPriority;
  channel?: NotificationChannel;
  deduplicationKey?: string;
}

export interface NotificationGatewayDependencies {
  now?: () => Date;
  resolveChatId: (userId: string) => Promise<string | undefined>;
  sendTelegram: (chatId: string, message: string, disableNotification: boolean) => Promise<boolean>;
  logger?: Pick<Console, 'info' | 'warn'>;
}

function isInSilenceWindow(now: Date): boolean {
  const hour = now.getHours();
  return hour >= SILENCE_START_HOUR || hour < SILENCE_END_HOUR;
}

function hourBucket(now: Date): string {
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  const hour = `${now.getHours()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}-${hour}`;
}

export class NotificationGateway {
  private readonly nowProvider: () => Date;
  private readonly resolveChatId: (userId: string) => Promise<string | undefined>;
  private readonly sendTelegram: (chatId: string, message: string, disableNotification: boolean) => Promise<boolean>;
  private readonly logger: Pick<Console, 'info' | 'warn'>;
  private readonly deduplicationState = new Map<string, number>();
  private readonly normalRateState = new Map<string, { hour: string; count: number }>();

  constructor(deps: NotificationGatewayDependencies) {
    this.nowProvider = deps.now ?? (() => new Date());
    this.resolveChatId = deps.resolveChatId;
    this.sendTelegram = deps.sendTelegram;
    this.logger = deps.logger ?? console;
  }

  async notify(userId: string, message: string, options: NotificationOptions): Promise<void> {
    const now = this.nowProvider();

    if (this.shouldSkipByDeduplication(options.deduplicationKey, now.getTime())) {
      return;
    }

    if (options.priority === 'LOW') {
      this.logOnly(userId, message, options.priority, now, 'low-priority');
      return;
    }

    if (options.priority === 'NORMAL') {
      if (isInSilenceWindow(now)) {
        return;
      }
      if (this.reachedNormalLimit(userId, now)) {
        return;
      }
    }

    const preferredChannel = options.channel ?? 'telegram';
    if (preferredChannel === 'log') {
      this.logOnly(userId, message, options.priority, now, 'log-channel');
      return;
    }

    const chatId = await this.resolveChatId(userId);
    if (!chatId) {
      this.logger.warn(`[Echo] Missing telegram_chat_id for user ${userId}. Falling back to log channel.`);
      this.logOnly(userId, message, options.priority, now, 'missing-chat-id');
      return;
    }

    const disableNotification = options.priority !== 'URGENT';
    await this.sendTelegram(chatId, message, disableNotification);
  }

  private shouldSkipByDeduplication(deduplicationKey: string | undefined, nowMs: number): boolean {
    if (!deduplicationKey) {
      this.cleanupDeduplicationState(nowMs);
      return false;
    }

    this.cleanupDeduplicationState(nowMs);
    const previousSentAt = this.deduplicationState.get(deduplicationKey);
    if (previousSentAt != null && nowMs - previousSentAt < DEDUP_WINDOW_MS) {
      return true;
    }
    this.deduplicationState.set(deduplicationKey, nowMs);
    return false;
  }

  private cleanupDeduplicationState(nowMs: number): void {
    for (const [key, sentAt] of this.deduplicationState.entries()) {
      if (nowMs - sentAt >= DEDUP_WINDOW_MS) {
        this.deduplicationState.delete(key);
      }
    }
  }

  private reachedNormalLimit(userId: string, now: Date): boolean {
    const currentHour = hourBucket(now);
    const current = this.normalRateState.get(userId);
    if (!current || current.hour !== currentHour) {
      this.normalRateState.set(userId, { hour: currentHour, count: 1 });
      return false;
    }
    if (current.count >= NORMAL_LIMIT_PER_HOUR) {
      return true;
    }
    current.count += 1;
    return false;
  }

  private logOnly(
    userId: string,
    message: string,
    priority: NotificationPriority,
    now: Date,
    reason: 'low-priority' | 'log-channel' | 'missing-chat-id'
  ): void {
    this.logger.info(
      `[Echo][${reason}] user=${userId} priority=${priority} at=${now.toISOString()} message=${message}`
    );
  }
}
