import { RecallTool, type RecallOutput } from './RecallTool.js';
import type { MemoryService } from './MemoryService.js';
import type { Memory } from './types.js';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function createMemoryServiceDouble(seed: Memory[]): MemoryService {
  const byUser = new Map<string, Memory[]>();
  for (const memory of seed) {
    const list = byUser.get(memory.userId) ?? [];
    list.push(memory);
    byUser.set(memory.userId, list);
  }
  return {
    async recall(userId: string, key?: string): Promise<Memory[]> {
      const all = byUser.get(userId) ?? [];
      if (key) {
        return all.filter((m) => m.key === key);
      }
      return all.slice();
    },
  } as unknown as MemoryService;
}

function unwrap(out: { success: boolean; data?: unknown; error?: string }): RecallOutput {
  if (!out.success) {
    throw new Error(`Tool returned error: ${out.error}`);
  }
  return out.data as RecallOutput;
}

const NOW = 1_700_000_000_000;

async function runTests(): Promise<void> {
  console.log('RecallTool tests...\n');

  const userId = 'u-franco';
  const seed: Memory[] = [
    {
      id: '1',
      userId,
      key: 'projects',
      value: 'PR de Dash pendiente para revisar antes del viernes',
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: '2',
      userId,
      key: 'projects',
      value: 'Llamar al equipo de Atlas la próxima semana',
      createdAt: NOW - 5_000,
      updatedAt: NOW - 5_000,
    },
    {
      id: '3',
      userId,
      key: 'other',
      value: 'Comprar pan en la panadería de la esquina',
      createdAt: NOW - 1_000,
      updatedAt: NOW - 1_000,
    },
    {
      id: '4',
      userId,
      key: 'projects',
      value: 'Dash necesita unit tests adicionales',
      createdAt: NOW - 10_000,
      updatedAt: NOW - 10_000,
    },
  ];

  console.log('Test: query about Dash returns Dash items first');
  {
    const tool = new RecallTool(createMemoryServiceDouble(seed));
    const result = unwrap(await tool.execute({ query: 'PR de Dash pendiente', userId }));
    assert(result.found, 'expected found to be true');
    assert(result.items.length >= 1, `expected at least one item, got ${result.items.length}`);
    assert(
      result.items[0]!.value.toLowerCase().includes('dash'),
      `expected the top result to mention Dash, got: ${result.items[0]!.value}`
    );
    assert(
      result.summary.toLowerCase().includes('dash'),
      `expected summary to mention Dash, got: ${result.summary}`
    );
    assert(
      result.items[0]!.updatedAt instanceof Date,
      'expected updatedAt to be a Date'
    );
    console.log('✓ Pass\n');
  }

  console.log('Test: empty result yields friendly summary');
  {
    const tool = new RecallTool(createMemoryServiceDouble(seed));
    const result = unwrap(await tool.execute({ query: 'kubernetes despliegue staging', userId }));
    assert(!result.found, 'expected found=false for unrelated query');
    assert(result.items.length === 0, 'expected no items');
    assert(
      result.summary.toLowerCase().startsWith('no encontré'),
      `expected friendly empty summary, got: ${result.summary}`
    );
    console.log('✓ Pass\n');
  }

  console.log('Test: project filter narrows results to the project');
  {
    const tool = new RecallTool(createMemoryServiceDouble(seed));
    const result = unwrap(await tool.execute({ query: 'pendiente', project: 'Dash', userId }));
    assert(result.found, 'expected at least one Dash item');
    assert(
      result.items.every((item) => item.value.toLowerCase().includes('dash')),
      'expected every returned item to mention the project filter'
    );
    assert(
      !result.items.some((item) => item.value.toLowerCase().includes('atlas')),
      'expected Atlas item to be filtered out'
    );
    console.log('✓ Pass\n');
  }

  console.log('Test: key filter restricts to that memory key');
  {
    const tool = new RecallTool(createMemoryServiceDouble(seed));
    const result = unwrap(await tool.execute({ query: 'pan', key: 'other', userId }));
    assert(result.found, 'expected to find at least one "other" memory');
    assert(
      result.items.every((item) => item.key === 'other'),
      'expected every item to have key=other'
    );
    console.log('✓ Pass\n');
  }

  console.log('Test: missing userId returns error');
  {
    const tool = new RecallTool(createMemoryServiceDouble(seed));
    const result = await tool.execute({ query: 'algo' });
    assert(!result.success, 'expected error result for missing userId');
    assert(
      typeof result.error === 'string' && /userid/i.test(result.error),
      `expected userId error message, got: ${result.error}`
    );
    console.log('✓ Pass\n');
  }

  console.log('Test: injectExecutionContext fills userId from ctx');
  {
    const tool = new RecallTool(createMemoryServiceDouble(seed));
    const inputBag: Record<string, unknown> = { query: 'Dash' };
    tool.injectExecutionContext(inputBag, { userId });
    assert(inputBag['userId'] === userId, 'expected userId injected from ctx');
    console.log('✓ Pass\n');
  }

  console.log('Test: formatToolOutput returns the summary string');
  {
    const tool = new RecallTool(createMemoryServiceDouble(seed));
    const result = unwrap(await tool.execute({ query: 'Dash', userId }));
    const formatted = tool.formatToolOutput?.(result, { userId });
    assert(typeof formatted === 'string' && formatted === result.summary, 'expected summary as formatted output');
    console.log('✓ Pass\n');
  }

  console.log('Test: triggers list contains the canonical phrases');
  {
    const tool = new RecallTool(createMemoryServiceDouble(seed));
    const triggers = (tool.triggers ?? []).map((t) => t.toLowerCase());
    for (const phrase of ['qué tengo pendiente', 'qué hay de', 'recordás', 'qué dijimos de', 'qué capturaste', 'mis tareas', 'pendientes de']) {
      assert(triggers.includes(phrase), `expected triggers to include "${phrase}"`);
    }
    console.log('✓ Pass\n');
  }

  console.log('RecallTool tests passed.');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
