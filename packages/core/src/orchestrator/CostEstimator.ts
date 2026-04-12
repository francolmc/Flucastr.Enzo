interface PricingRule {
  provider: string;
  modelPattern: RegExp;
  inputPer1M: number;
  outputPer1M: number;
}

interface EstimateCostInput {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

const PRICING_RULES: PricingRule[] = [
  // Local models are treated as zero marginal API cost.
  { provider: 'ollama', modelPattern: /.*/i, inputPer1M: 0, outputPer1M: 0 },
  // Anthropic references: approximate public list prices.
  { provider: 'anthropic', modelPattern: /claude-sonnet/i, inputPer1M: 3.0, outputPer1M: 15.0 },
  { provider: 'anthropic', modelPattern: /claude-haiku/i, inputPer1M: 0.8, outputPer1M: 4.0 },
  { provider: 'anthropic', modelPattern: /claude-opus/i, inputPer1M: 15.0, outputPer1M: 75.0 },
  // OpenAI references: approximate public list prices.
  { provider: 'openai', modelPattern: /gpt-4\\.1-mini/i, inputPer1M: 0.4, outputPer1M: 1.6 },
  { provider: 'openai', modelPattern: /gpt-4\\.1/i, inputPer1M: 2.0, outputPer1M: 8.0 },
  { provider: 'openai', modelPattern: /gpt-4o-mini/i, inputPer1M: 0.15, outputPer1M: 0.6 },
  { provider: 'openai', modelPattern: /gpt-4o/i, inputPer1M: 2.5, outputPer1M: 10.0 },
  // Gemini references: approximate public list prices.
  { provider: 'gemini', modelPattern: /gemini-1\\.5-flash/i, inputPer1M: 0.35, outputPer1M: 1.05 },
  { provider: 'gemini', modelPattern: /gemini-1\\.5-pro/i, inputPer1M: 3.5, outputPer1M: 10.5 },
  { provider: 'gemini', modelPattern: /gemini-2\\./i, inputPer1M: 1.0, outputPer1M: 4.0 },
  // Generic fallback by provider when model is unknown.
  { provider: 'anthropic', modelPattern: /.*/i, inputPer1M: 1.5, outputPer1M: 6.0 },
  { provider: 'openai', modelPattern: /.*/i, inputPer1M: 1.0, outputPer1M: 4.0 },
  { provider: 'gemini', modelPattern: /.*/i, inputPer1M: 0.8, outputPer1M: 3.0 },
];

function normalizeProvider(provider: string): string {
  return (provider || 'unknown').trim().toLowerCase();
}

function inferProviderFromModel(model: string): string {
  const normalized = (model || '').toLowerCase();
  if (normalized.includes('claude')) {
    return 'anthropic';
  }
  if (normalized.includes('gpt')) {
    return 'openai';
  }
  if (normalized.includes('gemini')) {
    return 'gemini';
  }
  if (normalized.includes('llama') || normalized.includes('qwen') || normalized.includes('mistral')) {
    return 'ollama';
  }
  return 'unknown';
}

export function estimateCostUsd(input: EstimateCostInput): number {
  const provider = normalizeProvider(input.provider);
  const model = input.model || '';
  const resolvedProvider = provider === 'unknown' ? inferProviderFromModel(model) : provider;

  const pricing = PRICING_RULES.find(
    (rule) => rule.provider === resolvedProvider && rule.modelPattern.test(model)
  );

  if (!pricing) {
    return 0;
  }

  const inputCost = (Math.max(0, input.inputTokens) / 1_000_000) * pricing.inputPer1M;
  const outputCost = (Math.max(0, input.outputTokens) / 1_000_000) * pricing.outputPer1M;
  const total = inputCost + outputCost;
  return Number(total.toFixed(8));
}
