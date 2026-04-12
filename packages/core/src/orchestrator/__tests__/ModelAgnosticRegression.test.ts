import { Classifier } from '../Classifier.js';
import { CapabilityResolver } from '../CapabilityResolver.js';
import { IntentAnalyzer } from '../IntentAnalyzer.js';
import { ComplexityLevel, AvailableCapabilities } from '../types.js';
import { CompletionRequest, CompletionResponse, LLMProvider } from '../../providers/types.js';
import { parseFirstJsonObject } from '../../utils/StructuredJson.js';

class QueueProvider implements LLMProvider {
  name = 'mock';
  model = 'mock-model';
  private queue: string[];

  constructor(queue: string[]) {
    this.queue = [...queue];
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async complete(_request: CompletionRequest): Promise<CompletionResponse> {
    const content = this.queue.length > 0 ? this.queue.shift()! : '{"type":"none","target":"","reason":"fallback","confidence":0.1}';
    return {
      content,
      usage: { inputTokens: 1, outputTokens: 1 },
      model: this.model,
      provider: this.name,
    };
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function runTests() {
  console.log('Running model-agnostic regression tests...\n');

  // Test 1: Structured parser must extract first JSON from noisy output.
  const noisy = 'text before {"action":"tool","tool":"read_file","input":{"path":"/tmp/a.txt"}} trailing';
  const parsedNoisy = parseFirstJsonObject<any>(noisy, { tryRepair: true });
  assert(!!parsedNoisy, 'Test 1 failed: parser did not extract JSON from noisy content');
  assert(parsedNoisy!.value.tool === 'read_file', 'Test 1 failed: wrong tool parsed');
  console.log('✓ Test 1: structured parser extracts noisy JSON');

  // Test 2: Classifier fallback must be MODERATE for action-verb prompts even with invalid model output.
  const classifier = new Classifier(new QueueProvider(['not-json', 'still not json']));
  const classification = await classifier.classify('lee este archivo y resumelo', []);
  assert(classification.level === ComplexityLevel.MODERATE, `Test 2 failed: expected MODERATE fallback, got ${classification.level}`);
  console.log('✓ Test 2: classifier safe fallback for action prompts');

  // Test 3: IntentAnalyzer should preserve tool input payload.
  const intentAnalyzer = new IntentAnalyzer(
    new QueueProvider([
      '{"type":"tool","target":"mcp_server_echo","reason":"Tool required","confidence":0.95,"input":{"message":"hello"}}',
    ])
  );
  const intent = await intentAnalyzer.analyzeIntent('use echo', [], [], []);
  assert(intent.type === 'tool', 'Test 3 failed: expected tool type');
  assert(intent.input?.message === 'hello', 'Test 3 failed: expected preserved input payload');
  console.log('✓ Test 3: intent analyzer preserves input payload');

  // Test 4: CapabilityResolver should use IntentAnalyzer input instead of empty object.
  const resolver = new CapabilityResolver();
  resolver.setIntentAnalyzer(
    new IntentAnalyzer(
      new QueueProvider([
        '{"type":"tool","target":"execute_command","reason":"Need shell","confidence":0.9,"input":{"command":"pwd"}}',
      ])
    )
  );

  const capabilities: AvailableCapabilities = {
    tools: [
      {
        name: 'execute_command',
        description: 'Execute shell command',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' },
          },
          required: ['command'],
        },
      },
    ],
    skills: [],
    agents: [],
  };

  const resolved = await resolver.resolve('no valid json here', capabilities);
  assert(resolved.type === 'tool', 'Test 4 failed: expected resolved tool action');
  assert(resolved.target === 'execute_command', `Test 4 failed: unexpected target ${resolved.target}`);
  assert(resolved.input?.command === 'pwd', 'Test 4 failed: expected input.command from analyzer');
  console.log('✓ Test 4: capability resolver keeps tool input from analyzer');

  console.log('\nAll model-agnostic regression tests passed.');
}

runTests().catch((error) => {
  console.error('Model-agnostic regression tests failed:', error);
  process.exitCode = 1;
});
