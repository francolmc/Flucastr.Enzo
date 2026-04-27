import {
  buildMorningBriefingMessage,
  createMorningBriefingTask,
} from './MorningBriefingTask.js';
import { ECHO_NOTIFICATION_PRIORITY } from '../NotificationGateway.js';
import type { Memory } from '../../memory/types.js';

function assert(cond: boolean, message: string): void {
  if (!cond) {
    throw new Error(message);
  }
}

async function runTests(): Promise<void> {
  console.log('MorningBriefingTask tests...\n');

  console.log('Test: builds morning briefing with top memories and class reminder');
  const now = new Date('2026-04-27T07:00:00.000Z');
  const memories: Memory[] = [
    { id: '1', userId: 'franco', key: 'projects', value: 'Proyecto A', createdAt: 1, updatedAt: 3000 },
    { id: '2', userId: 'franco', key: 'other', value: 'Preparar clase de hoy', createdAt: 1, updatedAt: 2000 },
    { id: '3', userId: 'franco', key: 'projects', value: 'Proyecto B', createdAt: 1, updatedAt: 1000 },
  ];
  const message = buildMorningBriefingMessage({
    now,
    locale: 'es-AR',
    memories,
  });
  assert(message.includes('Buenos dias Franco ☀️'), 'expected greeting in briefing');
  assert(message.includes('📋 Pendientes:'), 'expected pending section');
  assert(message.includes('- Proyecto A'), 'expected most recent project included');
  assert(message.includes('🎓 Clase hoy a las 19h'), 'expected class reminder on weekday');
  assert(message.includes('💡 Captura algo antes de arrancar el dia.'), 'expected capture reminder');
  console.log('✓ Pass\n');

  console.log('Test: task sends urgent notification with generated briefing');
  let notifiedPriority: string | undefined;
  let notifiedMessage = '';
  const task = createMorningBriefingTask({
    memoryService: {
      recall: async () => memories,
    },
    notificationGateway: {
      notify: async (notification) => {
        notifiedPriority = notification.priority;
        notifiedMessage = notification.message;
        return true;
      },
    },
    resolveUserId: async () => 'franco',
    now: () => now,
    locale: 'es-AR',
  });
  const result = await task.action();
  assert(result.success, 'expected task to succeed');
  assert(notifiedPriority === ECHO_NOTIFICATION_PRIORITY.URGENT, 'expected urgent priority');
  assert(notifiedMessage.includes('Buenos dias Franco'), 'expected generated briefing to be sent');
  console.log('✓ Pass\n');

  console.log('MorningBriefingTask tests passed.');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
