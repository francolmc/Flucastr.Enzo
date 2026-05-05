import { createNightSummaryTask } from './NightSummaryTask.js';
import type { Memory } from '../../memory/types.js';

function assert(cond: boolean, message: string): void {
  if (!cond) {
    throw new Error(message);
  }
}

async function runTests(): Promise<void> {
  console.log('NightSummaryTask tests...\n');

  console.log('Test: stores daily summary in other memory key');
  const now = new Date('2026-04-27T22:30:00.000Z');
  const nowMs = now.getTime();
  const memories: Memory[] = [
    {
      id: 'm1',
      userId: 'franco',
      key: 'projects',
      value: 'Avance del proyecto principal',
      createdAt: nowMs - 10_000,
      updatedAt: nowMs - 2 * 60 * 60 * 1000,
    },
    {
      id: 'm2',
      userId: 'franco',
      key: 'other',
      value: 'Capture idea para clase',
      createdAt: nowMs - 20_000,
      updatedAt: nowMs - 60 * 60 * 1000,
    },
  ];
  const remembered: Array<{ userId: string; key: string; value: string }> = [];
  const task = createNightSummaryTask({
    memoryService: {
      recall: async () => memories,
      remember: async (userId, key, value) => {
        remembered.push({ userId, key, value });
      },
    },
    resolveUserId: async () => 'franco',
    now: () => now,
    locale: 'es-AR',
  });

  const result = await task.action();
  assert(result.success, 'expected night summary task success');
  assert(remembered.length === 1, 'expected one summary memory write');
  assert(remembered[0]?.key === 'other', 'expected summary key to be other');
  assert(remembered[0]?.value.startsWith('Resumen '), 'expected summary value prefix');
  assert(remembered[0]?.value.includes('2026'), 'expected summary to include today date');
  assert(remembered[0]?.value.includes('Avance del proyecto principal'), 'expected summary to include daily content');
  console.log('✓ Pass\n');

  console.log('NightSummaryTask tests passed.');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
