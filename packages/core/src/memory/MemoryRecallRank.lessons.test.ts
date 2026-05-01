import type { MemoryLesson } from './types.js';
import { rankLessonsByLexicalSimilarity, selectLessonsForUserMessage } from './MemoryRecallRank.js';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function lesson(id: string, situation: string, updatedAt: number): MemoryLesson {
  return {
    id,
    userId: 'u1',
    situation,
    avoid: 'bad',
    prefer: 'good',
    source: 'tool_failure',
    confidence: 0.7,
    active: true,
    createdAt: 1,
    updatedAt,
  };
}

async function run(): Promise<void> {
  console.log('MemoryRecallRank lessons tests...\n');

  const two = [
    lesson('w', 'weather API ciudad clima Santiago', 10),
    lesson('x', 'compras supermercado lista', 20),
  ];
  const top = rankLessonsByLexicalSimilarity('cómo va el tiempo en Santiago hoy?', two, 1);
  assert(top.length === 1 && top[0]!.id === 'w', 'lexical picks weather-related lesson');

  const prevRank = process.env.ENZO_LESSONS_RECALL_TOP_K;
  const prevPin = process.env.ENZO_LESSONS_ALWAYS_PIN;
  const prevMax = process.env.ENZO_LESSONS_MAX_IN_PROMPT;

  try {
    process.env.ENZO_LESSONS_RECALL_TOP_K = '4';
    process.env.ENZO_LESSONS_ALWAYS_PIN = '1';
    process.env.ENZO_LESSONS_MAX_IN_PROMPT = '10';

    const many = [
      lesson('newest', 'tema unrelated zorro', 500),
      lesson('weather2', 'clima ciudad pronóstico', 100),
    ];
    const picked = selectLessonsForUserMessage(many, 'dame el clima');
    assert(picked.length >= 2, 'picked at least pinned + ranked');
    assert(picked[0]!.id === 'newest', 'first row is pinned (most recently updated)');
    assert(picked.some((p) => p.id === 'weather2'), 'ranked weather lesson included');

    console.log('✓ rankLessonsByLexicalSimilarity + selectLessonsForUserMessage\n');
  } finally {
    if (prevRank === undefined) delete process.env.ENZO_LESSONS_RECALL_TOP_K;
    else process.env.ENZO_LESSONS_RECALL_TOP_K = prevRank;
    if (prevPin === undefined) delete process.env.ENZO_LESSONS_ALWAYS_PIN;
    else process.env.ENZO_LESSONS_ALWAYS_PIN = prevPin;
    if (prevMax === undefined) delete process.env.ENZO_LESSONS_MAX_IN_PROMPT;
    else process.env.ENZO_LESSONS_MAX_IN_PROMPT = prevMax;
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
