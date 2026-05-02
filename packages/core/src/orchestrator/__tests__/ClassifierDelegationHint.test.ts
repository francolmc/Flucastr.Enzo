import { Classifier } from '../Classifier.js';
import { ComplexityLevel, type AgentConfig } from '../types.js';
import type { CompletionRequest, CompletionResponse, LLMProvider } from '../../providers/types.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const preset: AgentConfig = {
  id: 'p1',
  name: 'Visor de imágenes',
  description: 'Analiza imágenes adjuntas',
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20241022',
};

class StubProvider implements LLMProvider {
  name = 'stub';
  model = 'stub-m';
  constructor(private readonly json: string) {}
  async isAvailable(): Promise<boolean> {
    return true;
  }
  async complete(_req: CompletionRequest): Promise<CompletionResponse> {
    return {
      content: this.json,
      usage: { inputTokens: 1, outputTokens: 1 },
      model: this.model,
      provider: this.name,
    };
  }
}

async function testLlmReturnsDelegationHint(): Promise<void> {
  process.env.ENZO_CLASSIFIER_LLM_ALWAYS = 'true';
  const json = JSON.stringify({
    level: 'MODERATE',
    reason: 'User needs image analysis',
    delegationHint: { agentId: 'p1', reason: 'Preset handles vision' },
  });
  const c = new Classifier(new StubProvider(json));
  const r = await c.classify('¿Qué ves en la imagen?', [], {
    availableAgents: [preset],
    hasImageContext: true,
  });
  assert(r.level === ComplexityLevel.MODERATE, `level ${r.level}`);
  assert(r.delegationHint?.agentId === 'p1', 'hint id');
  assert(Boolean(r.delegationHint?.reason?.includes('vision')), 'hint reason');
  delete process.env.ENZO_CLASSIFIER_LLM_ALWAYS;
}

async function testRejectsInventedAgentId(): Promise<void> {
  process.env.ENZO_CLASSIFIER_LLM_ALWAYS = 'true';
  const json = JSON.stringify({
    level: 'MODERATE',
    reason: 'x',
    delegationHint: { agentId: 'not-in-catalog', reason: 'bad id stripped' },
  });
  const c = new Classifier(new StubProvider(json));
  const r = await c.classify('x', [], { availableAgents: [preset], hasImageContext: false });
  assert(r.delegationHint?.agentId === undefined, 'bad id stripped');
  assert(r.delegationHint?.reason === 'bad id stripped', 'reason kept');
  delete process.env.ENZO_CLASSIFIER_LLM_ALWAYS;
}

async function run(): Promise<void> {
  await testLlmReturnsDelegationHint();
  await testRejectsInventedAgentId();
  console.log('ClassifierDelegationHint tests passed.');
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
