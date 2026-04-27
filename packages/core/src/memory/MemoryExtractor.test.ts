import { MemoryExtractor, type ExtractedFact } from './MemoryExtractor.js';
import type { LLMProvider, CompletionRequest, CompletionResponse } from '../providers/types.js';
import type { MemoryService } from './MemoryService.js';
import type { Memory } from './types.js';
import { normalizeMemoryKey } from './MemoryKeys.js';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

class MockMemoryExtractorProvider implements LLMProvider {
  name = 'mock';
  model = 'mock';
  private scenario:
    | 'name'
    | 'empty'
    | 'nombre'
    | 'occupation'
    | 'name_thrice' = 'name';

  setScenario(
    s: 'name' | 'empty' | 'nombre' | 'occupation' | 'name_thrice'
  ): void {
    this.scenario = s;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async complete(_req: CompletionRequest): Promise<CompletionResponse> {
    if (this.scenario === 'name') {
      return {
        content: JSON.stringify({
          facts: [{ key: 'name', value: 'Franco', confidence: 0.9 }],
        }),
        usage: { inputTokens: 1, outputTokens: 1 },
        model: this.model,
        provider: this.name,
      };
    }
    if (this.scenario === 'nombre') {
      return {
        content: JSON.stringify({
          facts: [{ key: 'nombre', value: 'Ana' }],
        }),
        usage: { inputTokens: 1, outputTokens: 1 },
        model: this.model,
        provider: this.name,
      };
    }
    if (this.scenario === 'occupation') {
      return {
        content: JSON.stringify({
          facts: [{ key: 'occupation', value: 'engineer' }],
        }),
        usage: { inputTokens: 1, outputTokens: 1 },
        model: this.model,
        provider: this.name,
      };
    }
    if (this.scenario === 'name_thrice') {
      return {
        content: JSON.stringify({
          facts: [{ key: 'name', value: 'Franco' }],
        }),
        usage: { inputTokens: 1, outputTokens: 1 },
        model: this.model,
        provider: this.name,
      };
    }
    return {
      content: JSON.stringify({ facts: [] }),
      usage: { inputTokens: 1, outputTokens: 1 },
      model: this.model,
      provider: this.name,
    };
  }
}

function createMemoryServiceDouble(): {
  service: MemoryService;
  getRememberPayloads: () => { userId: string; key: string; value: string }[];
  allForUser: (userId: string) => Promise<Memory[]>;
} {
  const byUser = new Map<string, Map<string, { value: string; id: string }>>();
  const rememberLog: { userId: string; key: string; value: string }[] = [];
  const service = {
    async remember(userId: string, key: string, value: string): Promise<void> {
      rememberLog.push({ userId, key, value });
      let m = byUser.get(userId);
      if (!m) {
        m = new Map();
        byUser.set(userId, m);
      }
      m.set(key, { value, id: 'row' });
    },
    async recall(userId: string, key?: string): Promise<Memory[]> {
      const m = byUser.get(userId);
      if (!m) {
        return [];
      }
      const now = Date.now();
      if (key !== undefined) {
        const r = m.get(key);
        if (!r) {
          return [];
        }
        return [
          {
            id: r.id,
            userId,
            key,
            value: r.value,
            createdAt: now,
            updatedAt: now,
          },
        ];
      }
      return [...m.entries()].map(([k, r]) => ({
        id: r.id,
        userId,
        key: k,
        value: r.value,
        createdAt: now,
        updatedAt: now,
      }));
    },
  } as unknown as MemoryService;
  return {
    service,
    getRememberPayloads: () => rememberLog.slice(),
    allForUser: (userId: string) => (service as { recall: (u: string) => Promise<Memory[]> }).recall(userId),
  };
}

async function runTests(): Promise<void> {
  console.log('MemoryExtractor tests...\n');
  const provider = new MockMemoryExtractorProvider();
  const memStub = {} as MemoryService;
  const extractor = new MemoryExtractor(provider, memStub);
  const privateExtract = extractor as unknown as {
    extract: (a: string, b: string) => Promise<ExtractedFact[]>;
  };

  console.log('Test: extract name from "me llamo Franco"');
  provider.setScenario('name');
  const factFacts = await privateExtract.extract('Hola, me llamo Franco', 'Entendido.');
  const nameFact = factFacts.find((f) => f.key === 'name');
  assert(!!nameFact, 'expected a name fact');
  assert(nameFact!.value === 'Franco', 'expected value Franco');
  console.log('✓ Passed\n');

  console.log('Test: no personal data → empty facts');
  provider.setScenario('empty');
  const empty = await privateExtract.extract('What time is it?', 'I do not know.');
  assert(Array.isArray(empty) && empty.length === 0, 'expected no facts');
  console.log('✓ Passed\n');

  console.log('Test: normalizeMemoryKey(nombre) → name');
  assert(normalizeMemoryKey('nombre') === 'name', 'expected nombre -> name');
  console.log('✓ Passed\n');

  console.log('Test: normalizeMemoryKey(occupation) → profession');
  assert(normalizeMemoryKey('occupation') === 'profession', 'expected occupation -> profession');
  console.log('✓ Passed\n');

  console.log('Test: key "nombre" from model is stored as "name"');
  provider.setScenario('nombre');
  const doubleNombre = createMemoryServiceDouble();
  const extNombre = new MemoryExtractor(provider, doubleNombre.service);
  await extNombre.extractAndSave('u1', 'Hola', 'ok');
  const payloadsN = doubleNombre.getRememberPayloads();
  assert(payloadsN.length === 1, 'expected one remember');
  assert(payloadsN[0]!.key === 'name', 'expected key name');
  assert(payloadsN[0]!.value === 'Ana', 'expected value');
  console.log('✓ Passed\n');

  console.log('Test: key "occupation" from model is stored as "profession"');
  provider.setScenario('occupation');
  const doubleOcc = createMemoryServiceDouble();
  const extOcc = new MemoryExtractor(provider, doubleOcc.service);
  await extOcc.extractAndSave('u1', 'I work as engineer', 'ok');
  const payloadsO = doubleOcc.getRememberPayloads();
  assert(payloadsO.length === 1, 'expected one remember');
  assert(payloadsO[0]!.key === 'profession', 'expected key profession');
  assert(payloadsO[0]!.value === 'engineer', 'expected value');
  console.log('✓ Passed\n');

  console.log('Test: three conversations mentioning name → single row key=name');
  provider.setScenario('name_thrice');
  const double3 = createMemoryServiceDouble();
  const ext3 = new MemoryExtractor(provider, double3.service);
  await ext3.extractAndSave('u-merge', 'a', 'b');
  await ext3.extractAndSave('u-merge', 'c', 'd');
  await ext3.extractAndSave('u-merge', 'e', 'f');
  const all = await double3.allForUser('u-merge');
  const nameRows = all.filter((m) => m.key === 'name');
  assert(nameRows.length === 1, 'expected one memory row for name');
  assert(nameRows[0]!.value === 'Franco', 'expected value Franco');
  console.log('✓ Passed\n');

  console.log('MemoryExtractor tests passed.');
}

runTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
