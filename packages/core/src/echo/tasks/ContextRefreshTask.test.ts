import { createContextRefreshTask } from './ContextRefreshTask.js';
import type { Memory } from '../../memory/types.js';

function assert(cond: boolean, message: string): void {
  if (!cond) {
    throw new Error(message);
  }
}

async function runTests(): Promise<void> {
  console.log('ContextRefreshTask tests...\n');

  const now = new Date('2026-04-27T12:00:00.000Z');
  const nowMs = now.getTime();

  console.log('Test: stale project (4 days) triggers normal-priority notification');
  const staleProjectMemories: Memory[] = [
    {
      id: 'p1',
      userId: 'franco',
      key: 'projects',
      value: 'Proyecto Dormido',
      createdAt: nowMs - 6 * 24 * 60 * 60 * 1000,
      updatedAt: nowMs - 4 * 24 * 60 * 60 * 1000,
    },
  ];
  let sentMessage = '';
  let sentPriority = '';
  const staleTask = createContextRefreshTask({
    memoryService: { recall: async () => staleProjectMemories },
    notificationGateway: {
      notify: async (_userId, message, options) => {
        sentMessage = message;
        sentPriority = options.priority;
      },
    },
    resolveUserId: async () => 'franco',
    now: () => now,
  });
  const staleResult = await staleTask.action();
  assert(staleResult.success, 'expected stale project scenario to succeed');
  assert(staleResult.notified === true, 'expected stale project scenario to notify');
  assert(sentPriority === 'NORMAL', 'expected normal priority');
  assert(sentMessage.includes('3 dias sin actividad'), 'expected stale project message');
  console.log('✓ Pass\n');

  console.log('Test: recent project does not trigger notification');
  let notifyCalls = 0;
  const recentProjectMemories: Memory[] = [
    {
      id: 'p2',
      userId: 'franco',
      key: 'projects',
      value: 'Proyecto Activo',
      createdAt: nowMs - 2 * 24 * 60 * 60 * 1000,
      updatedAt: nowMs - 6 * 60 * 60 * 1000,
    },
  ];
  const recentTask = createContextRefreshTask({
    memoryService: { recall: async () => recentProjectMemories },
    notificationGateway: {
      notify: async () => {
        notifyCalls += 1;
      },
    },
    resolveUserId: async () => 'franco',
    now: () => now,
  });
  const recentResult = await recentTask.action();
  assert(recentResult.success, 'expected recent project scenario to succeed');
  assert(recentResult.notified === false, 'expected no notification for recent project');
  assert(notifyCalls === 0, 'expected notification gateway to not be called');
  console.log('✓ Pass\n');

  console.log('ContextRefreshTask tests passed.');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
