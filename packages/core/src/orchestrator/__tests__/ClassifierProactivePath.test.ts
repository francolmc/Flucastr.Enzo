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
  console.log('Running Classifier proactive-path table tests...\n');

  const cHello = new Classifier(new QueueProvider([]));
  const r0 = await cHello.classify('hola', []);
  assertEq(r0.level, ComplexityLevel.SIMPLE, '"hola" should be SIMPLE');
  assertEq(r0.classifierBranch, 'trivial', '"hola" should use trivial fast path branch');
  console.log('✓ "hola" → SIMPLE (fast path)');

  const cMath = new Classifier(
    new QueueProvider(['{"level":"SIMPLE","reason":"math calculation"}'])
  );
  const r1 = await cMath.classify('cuánto es 2+2', []);
  assertEq(r1.level, ComplexityLevel.SIMPLE, '"cuánto es 2+2" should be SIMPLE (LLM path with mock)');
  assertEq(r1.classifierBranch, 'llm', 'LLM path should set classifierBranch llm');
  console.log('✓ "cuánto es 2+2" → SIMPLE (mocked LLM)');

  const cAtacama = new Classifier(
    new QueueProvider(['{"level":"MODERATE","reason":"factual question requiring web search"}'])
  );
  const r2 = await cAtacama.classify('what is the Atacama Desert?', []);
  assertEq(r2.level, ComplexityLevel.MODERATE, 'Atacama should be MODERATE');
  console.log('✓ "what is the Atacama Desert?" → MODERATE (mocked LLM)');

  const cCeo = new Classifier(new QueueProvider([]));
  const r3 = await cCeo.classify('quién es el CEO de Apple?', []);
  assertEq(r3.level, ComplexityLevel.MODERATE, 'CEO / Apple should be MODERATE');
  assertEq(r3.suggestedTool, 'web_search', 'CEO should suggest web_search on factual fast path');
  assertEq(r3.classifierBranch, 'factual_lexical', 'CEO query should hit factual lexical branch');
  console.log('✓ "quién es el CEO de Apple?" → MODERATE (factual fast path)');

  const cDollar = new Classifier(new QueueProvider([]));
  const r4 = await cDollar.classify('cuánto está el dólar hoy?', []);
  assertEq(r4.level, ComplexityLevel.MODERATE, 'dólar hoy should be MODERATE');
  console.log('✓ "cuánto está el dólar hoy?" → MODERATE (factual fast path)');

  const cNews = new Classifier(new QueueProvider([]));
  const r5 = await cNews.classify('qué noticias hay hoy?', []);
  assertEq(r5.level, ComplexityLevel.MODERATE, 'noticias hoy should be MODERATE');
  console.log('✓ "qué noticias hay hoy?" → MODERATE (factual fast path)');

  const cWeather = new Classifier(new QueueProvider([]));
  const r6 = await cWeather.classify('busca el clima de Santiago', []);
  assertEq(r6.level, ComplexityLevel.MODERATE, 'clima Santiago should be MODERATE');
  console.log('✓ "busca el clima de Santiago" → MODERATE (factual/bundle fast path)');

  const cWritePath = new Classifier(new QueueProvider([]));
  const rWrite = await cWritePath.classify(
    'creá el archivo /home/franco/historia.md con una historia corta',
    []
  );
  assertEq(rWrite.level, ComplexityLevel.MODERATE, 'create file at absolute path should be MODERATE');
  assertEq(
    rWrite.classifierBranch,
    'write_file_lexical_hint',
    'persist-to-path intent should use write_file_lexical_hint branch'
  );
  console.log('✓ "creá … /home/franco/historia.md …" → MODERATE (write_file lexical hint)');

  const cDash = new Classifier(new QueueProvider([]));
  const r7 = await cDash.classify('qué tengo pendiente de Dash?', []);
  assertEq(r7.level, ComplexityLevel.MODERATE, 'Dash pending should be MODERATE');
  assertEq(r7.classifierBranch, 'recall_lexical', 'Dash recall should use recall lexical branch');
  assertCondition(
    r7.reason.toLowerCase().includes('recall') && !r7.reason.toLowerCase().includes('web_search'),
    'Dash query should be recall, not a web search classification'
  );
  console.log('✓ "qué tengo pendiente de Dash?" → MODERATE (recall fast path)');

  const cAgenda = new Classifier(new QueueProvider([]));
  const rAgenda = await cAgenda.classify(
    '¡Hola! ¿podemos agendar un evento para las 15:55 horas del día de hoy? El evento es tomar medicamento.',
    []
  );
  assertEq(rAgenda.level, ComplexityLevel.MODERATE, 'persisted timed agenda should be MODERATE');
  assertEq(rAgenda.classifierBranch, 'schedule_persist_lexical', 'agenda persist should hit schedule lexical branch');
  assertEq(rAgenda.suggestedTool, 'calendar', 'agenda lexical path should hint calendar tool');
  console.log(
    '✓ "podemos agendar … 15:55 … hoy … medicamento …" → MODERATE + schedule_persist_lexical + calendar hint'
  );

  const prevLlmAlways = process.env.ENZO_CLASSIFIER_LLM_ALWAYS;
  process.env.ENZO_CLASSIFIER_LLM_ALWAYS = 'true';
  try {
    const cLlmAlways = new Classifier(new QueueProvider(['{"level":"SIMPLE","reason":"greeting ambiguous"}']));
    const r8 = await cLlmAlways.classify('hola', []);
    assertEq(r8.level, ComplexityLevel.SIMPLE, 'ENZO_CLASSIFIER_LLM_ALWAYS: mocked LLM should win over trivial regex');
    assertEq(r8.classifierBranch, 'llm_always', 'ENZO_CLASSIFIER_LLM_ALWAYS should tag branch llm_always');
  } finally {
    process.env.ENZO_CLASSIFIER_LLM_ALWAYS = prevLlmAlways;
    if (prevLlmAlways === undefined) {
      delete process.env.ENZO_CLASSIFIER_LLM_ALWAYS;
    }
  }
  console.log('✓ ENZO_CLASSIFIER_LLM_ALWAYS skips trivial regex and uses llm_always branch');

  console.log('\nAll Classifier proactive-path table tests passed.');
}

runTests().catch((error) => {
  console.error('Classifier proactive-path tests failed:', error);
  process.exitCode = 1;
});
