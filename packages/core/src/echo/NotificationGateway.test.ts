import { NotificationGateway } from './NotificationGateway.js';

function assert(cond: boolean, message: string): void {
  if (!cond) {
    throw new Error(message);
  }
}

async function runTests(): Promise<void> {
  console.log('NotificationGateway tests...\n');

  console.log('Test: URGENT during silence window still sends');
  const urgentCalls: Array<{ chatId: string; message: string; disableNotification: boolean }> = [];
  const urgentGateway = new NotificationGateway({
    now: () => new Date('2026-04-27T03:15:00.000Z'),
    resolveChatId: async () => 'chat-1',
    sendTelegram: async (chatId, message, disableNotification) => {
      urgentCalls.push({ chatId, message, disableNotification });
      return true;
    },
    logger: console,
  });
  await urgentGateway.notify('user-1', 'Urgent ping', { priority: 'URGENT' });
  assert(urgentCalls.length === 1, 'expected urgent notification to be sent');
  assert(urgentCalls[0]?.disableNotification === false, 'expected urgent message to ring');
  console.log('✓ Pass\n');

  console.log('Test: NORMAL during silence window is skipped');
  const normalSilenceCalls: unknown[] = [];
  const normalSilenceGateway = new NotificationGateway({
    now: () => new Date('2026-04-27T03:30:00.000Z'),
    resolveChatId: async () => 'chat-1',
    sendTelegram: async (...args) => {
      normalSilenceCalls.push(args);
      return true;
    },
    logger: console,
  });
  await normalSilenceGateway.notify('user-1', 'Normal ping', { priority: 'NORMAL' });
  assert(normalSilenceCalls.length === 0, 'expected normal notification to be skipped in silence');
  console.log('✓ Pass\n');

  console.log('Test: duplicate deduplicationKey within 4h is ignored');
  let dedupNow = new Date('2026-04-27T12:00:00.000Z').getTime();
  const dedupCalls: unknown[] = [];
  const dedupGateway = new NotificationGateway({
    now: () => new Date(dedupNow),
    resolveChatId: async () => 'chat-2',
    sendTelegram: async (...args) => {
      dedupCalls.push(args);
      return true;
    },
    logger: console,
  });
  await dedupGateway.notify('user-2', 'Dedup ping', {
    priority: 'URGENT',
    deduplicationKey: 'same-key',
  });
  dedupNow += 30 * 60 * 1000;
  await dedupGateway.notify('user-2', 'Dedup ping second', {
    priority: 'URGENT',
    deduplicationKey: 'same-key',
  });
  assert(dedupCalls.length === 1, 'expected second deduplicated notification to be skipped');
  console.log('✓ Pass\n');

  console.log('Test: 4th NORMAL in same hour is skipped');
  let rateNow = new Date('2026-04-27T12:05:00.000Z').getTime();
  const rateCalls: unknown[] = [];
  const rateGateway = new NotificationGateway({
    now: () => new Date(rateNow),
    resolveChatId: async () => 'chat-3',
    sendTelegram: async (...args) => {
      rateCalls.push(args);
      return true;
    },
    logger: console,
  });
  await rateGateway.notify('user-3', 'N1', { priority: 'NORMAL' });
  rateNow += 5 * 60 * 1000;
  await rateGateway.notify('user-3', 'N2', { priority: 'NORMAL' });
  rateNow += 5 * 60 * 1000;
  await rateGateway.notify('user-3', 'N3', { priority: 'NORMAL' });
  rateNow += 5 * 60 * 1000;
  await rateGateway.notify('user-3', 'N4', { priority: 'NORMAL' });
  assert(rateCalls.length === 3, 'expected 4th normal notification in same hour to be skipped');
  console.log('✓ Pass\n');

  console.log('Test: missing chatId falls back to log without error');
  const infoLogs: string[] = [];
  const warnLogs: string[] = [];
  const fallbackCalls: unknown[] = [];
  const fallbackGateway = new NotificationGateway({
    now: () => new Date('2026-04-27T12:30:00.000Z'),
    resolveChatId: async () => undefined,
    sendTelegram: async (...args) => {
      fallbackCalls.push(args);
      return true;
    },
    logger: {
      info: (msg: string) => infoLogs.push(msg),
      warn: (msg: string) => warnLogs.push(msg),
    },
  });
  await fallbackGateway.notify('user-4', 'No chat id', { priority: 'URGENT' });
  assert(fallbackCalls.length === 0, 'expected no telegram call without chat id');
  assert(warnLogs.length === 1, 'expected missing chat id warning');
  assert(infoLogs.length === 1, 'expected fallback to log channel');
  console.log('✓ Pass\n');

  console.log('NotificationGateway tests passed.');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
