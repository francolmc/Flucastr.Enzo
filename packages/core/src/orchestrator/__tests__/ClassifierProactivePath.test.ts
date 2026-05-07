import { Classifier } from '../Classifier.js';
import { ComplexityLevel } from '../types.js';
import { CompletionRequest, CompletionResponse, LLMProvider } from '../../providers/types.js';

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
    const content = this.queue.length > 0 ? this.queue.shift()! : '{}';
    return {
      content,
      usage: { inputTokens: 1, outputTokens: 1 },
      model: this.model,
      provider: this.name,
    };
  }
}

function assertEq<T>(a: T, b: T, message: string): void {
  if (a !== b) {
    throw new Error(`${message} (expected ${b}, got ${a})`);
  }
}

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function runTests() {
  console.log('Running Classifier LLM-first path tests...\n');

  const cMath = new Classifier(
    new QueueProvider(['{"level":"SIMPLE","reason":"math calculation"}'])
  );
  const r1 = await cMath.classify('how much is 2+2', []);
  assertEq(r1.level, ComplexityLevel.SIMPLE, 'math should be SIMPLE via LLM');
  assertEq(r1.classifierBranch, 'llm', 'LLM path should set classifierBranch llm');
  console.log('✓ "how much is 2+2" → SIMPLE (mocked LLM)');

  const cAtacama = new Classifier(
    new QueueProvider(['{"level":"MODERATE","reason":"factual question"}'])
  );
  const r2 = await cAtacama.classify('what is the Atacama Desert?', []);
  assertEq(r2.level, ComplexityLevel.MODERATE, 'Atacama should be MODERATE via LLM');
  console.log('✓ "what is the Atacama Desert?" → MODERATE (mocked LLM)');

  const cCeo = new Classifier(
    new QueueProvider(['{"level":"MODERATE","reason":"factual question"}'])
  );
  const r3 = await cCeo.classify('who is the CEO of Apple?', []);
  assertEq(r3.level, ComplexityLevel.MODERATE, 'CEO / Apple should be MODERATE');
  assertEq(r3.classifierBranch, 'llm', 'CEO query should use LLM branch');
  console.log('✓ "who is the CEO of Apple?" → MODERATE (mocked LLM)');

  const cRecall = new Classifier(
    new QueueProvider(['{"level":"MODERATE","reason":"recall query — needs RecallTool"}'])
  );
  const r4 = await cRecall.classify('what do I have pending for project X?', []);
  assertEq(r4.level, ComplexityLevel.MODERATE, 'recall query should be MODERATE via LLM');
  assertEq(r4.classifierBranch, 'llm', 'recall query should use LLM branch');
  assertCondition(
    r4.reason.toLowerCase().includes('recall'),
    'recall query reason should mention recall'
  );
  console.log('✓ "what do I have pending for project X?" → MODERATE (mocked LLM)');

  const cWritePath = new Classifier(new QueueProvider([]));
  const rWrite = await cWritePath.classify(
    'create the file /home/user/story.md with a short story',
    []
  );
  assertEq(rWrite.level, ComplexityLevel.MODERATE, 'create file at absolute path should be MODERATE');
  assertEq(
    rWrite.classifierBranch,
    'write_file_lexical_hint',
    'absolute path write intent should use write_file_lexical_hint structural branch'
  );
  console.log('✓ "create /home/user/story.md …" → MODERATE (structural path detection)');

  const prevLlmAlways = process.env.ENZO_CLASSIFIER_LLM_ALWAYS;
  process.env.ENZO_CLASSIFIER_LLM_ALWAYS = 'true';
  try {
    const cLlmAlways = new Classifier(new QueueProvider(['{"level":"SIMPLE","reason":"greeting"}']));
    const r5 = await cLlmAlways.classify('hello', []);
    assertEq(r5.level, ComplexityLevel.SIMPLE, 'ENZO_CLASSIFIER_LLM_ALWAYS: mocked LLM should be used');
    assertEq(r5.classifierBranch, 'llm_always', 'ENZO_CLASSIFIER_LLM_ALWAYS should tag branch llm_always');
  } finally {
    if (prevLlmAlways === undefined) {
      delete process.env.ENZO_CLASSIFIER_LLM_ALWAYS;
    } else {
      process.env.ENZO_CLASSIFIER_LLM_ALWAYS = prevLlmAlways;
    }
  }
  console.log('✓ ENZO_CLASSIFIER_LLM_ALWAYS uses llm_always branch');

  console.log('\nAll Classifier LLM-first path tests passed.');
}

runTests().catch((error) => {
  console.error('Classifier proactive-path tests failed:', error);
  process.exitCode = 1;
});
