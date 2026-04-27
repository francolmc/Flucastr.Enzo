import { MemoryExtractor, type ExtractedFact } from './MemoryExtractor.js';
import type { LLMProvider, CompletionRequest, CompletionResponse } from '../providers/types.js';
import type { MemoryService } from './MemoryService.js';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

class MockMemoryExtractorProvider implements LLMProvider {
  name = 'mock';
  model = 'mock';
  private scenario: 'name' | 'empty' = 'name';

  setScenario(s: 'name' | 'empty'): void {
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
    return {
      content: JSON.stringify({ facts: [] }),
      usage: { inputTokens: 1, outputTokens: 1 },
      model: this.model,
      provider: this.name,
    };
  }
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
