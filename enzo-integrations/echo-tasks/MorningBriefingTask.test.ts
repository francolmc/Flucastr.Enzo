import {
  buildMorningBriefingMessage,
  createMorningBriefingTask,
  formatAgendaTodaySection,
} from './MorningBriefingTask.js';
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

  console.log('Test: agenda today section renders local HH:MM');
  const tz = 'America/Santiago';
  const agendaFmt = formatAgendaTodaySection(
    [
      {
        id: 'e1',
        userId: 'franco',
        title: 'Tomar medicamento',
        startAt: Date.parse('2026-05-01T18:50:00.000Z'),
        endAt: null,
        notes: null,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    'es-CL',
    tz
  );
  assert(agendaFmt.includes('Tomar medicamento'), 'title in agenda section');
  assert(agendaFmt.includes(':'), 'expects a clock fragment');
  console.log('✓ Pass\n');

  console.log('Test: task sends urgent notification with generated briefing');
  let notifiedPriority: string | undefined;
  let notifiedMessage = '';
  let notifiedDedupKey = '';
  const task = createMorningBriefingTask({
    memoryService: {
      recall: async () => memories,
    },
    notificationGateway: {
      notify: async (_userId, message, options) => {
        notifiedPriority = options.priority;
        notifiedMessage = message;
        notifiedDedupKey = options.deduplicationKey || '';
      },
    },
    resolveUserId: async () => 'franco',
    now: () => now,
    locale: 'es-AR',
  });
  const result = await task.action();
  assert(result.success, 'expected task to succeed');
  assert(notifiedPriority === 'URGENT', 'expected urgent priority');
  assert(notifiedMessage.includes('Buenos dias Franco'), 'expected generated briefing to be sent');
  assert(notifiedDedupKey.includes('morning-briefing-2026-04-27'), 'expected dedup key by date');
  console.log('✓ Pass\n');

  console.log('Test: morning briefing includes persisted calendar when wired');
  let briefingWithCalendar = '';
  const taskEcho = createMorningBriefingTask({
    memoryService: {
      recall: async () => memories,
    },
    notificationGateway: {
      notify: async (_userId, message) => {
        briefingWithCalendar = message;
      },
    },
    resolveUserId: async () => 'franco',
    now: () => now,
    locale: 'es-AR',
    calendarService: {
      listInRange: async () => [
        {
          id: 'rx',
          userId: 'franco',
          title: 'Revisar PR',
          startAt: Date.parse('2026-04-27T14:00:00.000Z'),
          endAt: null,
          notes: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    },
    buildRuntimeHints: () => ({
      timeZone: 'America/Santiago',
      timeLocale: 'es-CL',
      osLabel: 'macOS',
      homeDir: '/tmp',
      posixShell: true,
      hostPlatform: 'darwin',
    }),
  });
  await taskEcho.action();
  assert(briefingWithCalendar.includes('📅 Agenda hoy'), 'calendar section header');
  assert(briefingWithCalendar.includes('Revisar PR'), 'calendar event title in briefing');

  console.log('MorningBriefingTask tests passed.');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
