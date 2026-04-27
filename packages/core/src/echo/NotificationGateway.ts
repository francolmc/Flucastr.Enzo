export const ECHO_NOTIFICATION_PRIORITY = {
  URGENT: 'URGENT',
  NORMAL: 'NORMAL',
} as const;

export type EchoNotificationPriority =
  (typeof ECHO_NOTIFICATION_PRIORITY)[keyof typeof ECHO_NOTIFICATION_PRIORITY];

export interface EchoNotification {
  userId: string;
  message: string;
  priority: EchoNotificationPriority;
}

export interface NotificationGateway {
  notify(notification: EchoNotification): Promise<boolean>;
}
