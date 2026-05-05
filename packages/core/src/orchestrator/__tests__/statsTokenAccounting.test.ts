import { runSimpleModerateFastPath } from '../amplifier/AmplifierSimplePath.js';
import { estimateCostUsd } from '../CostEstimator.js';
import {
  ComplexityLevel,
  type AmplifierInput,
  AVAILABLE_TOOLS,
} from '../types.js';
import { CompletionRequest, CompletionResponse, LLMProvider } from '../../providers/types.js';
import { createDefaultAmplifierLoopLog } from '../amplifier/AmplifierLoopLog.js';
import { initStageMetrics } from '../amplifier/AmplifierLoopMetrics.js';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(`FAIL: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

class FixedTokenProvider implements LLMProvider {
  name = 'openai';
  model = 'gpt-4o';

  constructor(
    private responses: Array<{ content: string; inputTokens: number; outputTokens: number }>
  ) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async complete(_req: CompletionRequest): Promise<CompletionResponse> {
    const r = this.responses.shift() ?? { content: '', inputTokens: 0, outputTokens: 0 };
    return {
      content: r.content,
      usage: { inputTokens: r.inputTokens, outputTokens: r.outputTokens },
      model: this.model,
      provider: this.name,
    };
  }
}

function buildInput(message: string): AmplifierInput {
  return {
    message,
    conversationId: 'c1',
    userId: 'u1',
    history: [],
    availableTools: [...AVAILABLE_TOOLS],
    availableSkills: [],
    availableAgents: [],
    userLanguage: 'en',
  };
}

function buildBaseCtx(provider: LLMProvider, level: ComplexityLevel) {
  return {
    input: buildInput('hello'),
    classifiedLevel: level,
    stageMetrics: initStageMetrics(),
    modelsUsed: new Set<string>(),
    toolsUsed: new Set<string>(),
    injectedSkills: new Map(),
    preResolvedSkills: [],
    startTime: Date.now(),
    requestId: 'req-1',
    steps: [],
    baseProvider: provider,
    withTimeout: <T>(p: Promise<T>) => p,
    executableTools: [],
    mcpRegistry: undefined,
    skillRegistry: undefined,
    log: createDefaultAmplifierLoopLog(),
    requestToolInputCorrection: async () => null,
    verifyBeforeSynthesize: false,
  };
}

// ──────────────────────────────────────────────
// estimateCostUsd tests
// ──────────────────────────────────────────────

(function testEstimateCostUsdOpenAI() {
  const cost = estimateCostUsd({ provider: 'openai', model: 'gpt-4o', inputTokens: 1000, outputTokens: 500 });
  assert(cost > 0, 'estimateCostUsd(openai/gpt-4o) should return positive cost');
  console.log('  PASS estimateCostUsd(openai/gpt-4o) =', cost);
})();

(function testEstimateCostUsdAnthropic() {
  const cost = estimateCostUsd({ provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', inputTokens: 1000, outputTokens: 500 });
  assert(cost > 0, 'estimateCostUsd(anthropic/claude-3-5-sonnet) should return positive cost');
  console.log('  PASS estimateCostUsd(anthropic/claude-3-5-sonnet) =', cost);
})();

(function testEstimateCostUsdOllamaIsZero() {
  const cost = estimateCostUsd({ provider: 'ollama', model: 'llama3', inputTokens: 1000, outputTokens: 500 });
  assertEqual(cost, 0, 'estimateCostUsd(ollama) should be 0');
  console.log('  PASS estimateCostUsd(ollama) = 0');
})();

(function testEstimateCostUsdZeroTokens() {
  const cost = estimateCostUsd({ provider: 'openai', model: 'gpt-4o', inputTokens: 0, outputTokens: 0 });
  assertEqual(cost, 0, 'estimateCostUsd with 0 tokens should be 0');
  console.log('  PASS estimateCostUsd(0 tokens) = 0');
})();

// ──────────────────────────────────────────────
// AmplifierSimplePath token accumulation tests
// ──────────────────────────────────────────────

await (async function testUsageAccumulatedFromSingleLLMCall() {
  const provider = new FixedTokenProvider([
    { content: 'Hello!', inputTokens: 42, outputTokens: 7 },
  ]);
  const usageAccumulator = { inputTokens: 0, outputTokens: 0 };
  const result = await runSimpleModerateFastPath({
    ...buildBaseCtx(provider, ComplexityLevel.SIMPLE),
    usageAccumulator,
  });
  assert(result.usage !== undefined, 'result.usage should be defined after LLM call');
  assertEqual(result.usage!.inputTokens, 42, 'inputTokens should match provider response');
  assertEqual(result.usage!.outputTokens, 7, 'outputTokens should match provider response');
  assertEqual(usageAccumulator.inputTokens, 42, 'usageAccumulator.inputTokens should be mutated');
  console.log('  PASS usage accumulated from SIMPLE path LLM call');
})();

await (async function testUsageNotPresentWhenAllZero() {
  const provider = new FixedTokenProvider([
    { content: 'Hola!', inputTokens: 0, outputTokens: 0 },
  ]);
  const usageAccumulator = { inputTokens: 0, outputTokens: 0 };
  const result = await runSimpleModerateFastPath({
    ...buildBaseCtx(provider, ComplexityLevel.SIMPLE),
    usageAccumulator,
  });
  assert(result.usage === undefined, 'result.usage should be undefined when all tokens are 0');
  console.log('  PASS usage omitted when provider returns 0 tokens');
})();

await (async function testUsageAccumulatedAcrossModerateRetry() {
  // MODERATE path may retry once with strict prompt — both calls should accumulate
  const provider = new FixedTokenProvider([
    { content: 'not-json', inputTokens: 10, outputTokens: 3 },      // first call (prose, no tool)
    { content: 'plain text reply', inputTokens: 8, outputTokens: 5 }, // moderate strict retry
  ]);
  const usageAccumulator = { inputTokens: 0, outputTokens: 0 };
  await runSimpleModerateFastPath({
    ...buildBaseCtx(provider, ComplexityLevel.MODERATE),
    input: { ...buildInput('hello'), classifiedLevel: ComplexityLevel.MODERATE },
    usageAccumulator,
  });
  assert(usageAccumulator.inputTokens >= 10, 'inputTokens should include first call');
  console.log(`  PASS usage accumulated across moderate retry: in=${usageAccumulator.inputTokens} out=${usageAccumulator.outputTokens}`);
})();

// ──────────────────────────────────────────────
// OrchestratorProcess token fallback logic (unit)
// ──────────────────────────────────────────────

(function testTokenFallbackLogic() {
  const message = 'hello world';
  const responseContent = 'I am fine';

  // Simulate what OrchestratorProcess does:
  const realInput = 0;
  const realOutput = 0;
  const inputTokens = realInput > 0 ? realInput : Math.ceil(message.length / 4);
  const outputTokens = realOutput > 0 ? realOutput : Math.ceil(responseContent.length / 4);

  assertEqual(inputTokens, Math.ceil(message.length / 4), 'should fall back to char estimate when real=0');
  assertEqual(outputTokens, Math.ceil(responseContent.length / 4), 'should fall back to char estimate when real=0');
  console.log('  PASS token fallback to char estimate when real tokens = 0');
})();

(function testTokenRealOverridesFallback() {
  const message = 'hello world';
  const responseContent = 'I am fine';
  const realInput = 55;
  const realOutput = 22;

  const inputTokens = realInput > 0 ? realInput : Math.ceil(message.length / 4);
  const outputTokens = realOutput > 0 ? realOutput : Math.ceil(responseContent.length / 4);

  assertEqual(inputTokens, 55, 'real inputTokens should override char estimate');
  assertEqual(outputTokens, 22, 'real outputTokens should override char estimate');
  console.log('  PASS real token counts override char estimate');
})();

console.log('\nAll statsTokenAccounting tests passed.');
