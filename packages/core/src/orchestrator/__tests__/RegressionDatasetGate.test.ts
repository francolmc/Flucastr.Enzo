import fs from 'fs';
import path from 'path';
import { Classifier } from '../Classifier.js';
import { ComplexityLevel } from '../types.js';
import { CompletionRequest, CompletionResponse, LLMProvider } from '../../providers/types.js';

interface RegressionCase {
  message: string;
  expectedLevel: ComplexityLevel;
}

class DatasetProvider implements LLMProvider {
  name = 'dataset-mock';
  model = 'dataset-mock';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const userMessage = request.messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
    const normalized = userMessage.toLowerCase();
    let predicted: ComplexityLevel = ComplexityLevel.SIMPLE;
    const hasExplicitChain = /\b(and then|luego|despu[eé]s|con el resultado)\b/i.test(normalized);
    const hasImplicitReadThenWrite =
      (/\blee\s+/i.test(userMessage) && /\b(y\s+)?(crea|crear|guarda|guardar|escribe|escribir)\b/i.test(normalized)) ||
      (/\bread\s+/.test(normalized) && /\b(and\s+)?(create|save|write)\b/i.test(normalized));
    const hasChain = hasExplicitChain || hasImplicitReadThenWrite;
    const hasToolVerb =
      /\b(busca|read|lee|create|crea|crear|remember|guarda|list|ls|agendar|schedule|recordatorio|reminder|archivo|file)\b/i.test(
        normalized
      );
    const looksLikePersonalAgendaList =
      /\b(eventos|citas|appointments|meetings)\b/i.test(normalized) &&
      /\b(hoy|today|tomorrow|mañana|agenda|calendario|calendar)\b/i.test(normalized);
    if (hasChain) {
      predicted = ComplexityLevel.COMPLEX;
    } else if (hasToolVerb || looksLikePersonalAgendaList) {
      predicted = ComplexityLevel.MODERATE;
    }
    return {
      content: JSON.stringify({ level: predicted, reason: 'regression dataset gate' }),
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

async function run(): Promise<void> {
  const directPath = path.resolve(process.cwd(), 'src/orchestrator/__tests__/fixtures/regression-prompts.json');
  const monorepoPath = path.resolve(process.cwd(), 'packages/core/src/orchestrator/__tests__/fixtures/regression-prompts.json');
  const fixturePath = fs.existsSync(directPath) ? directPath : monorepoPath;
  const raw = fs.readFileSync(fixturePath, 'utf8');
  const cases = JSON.parse(raw) as RegressionCase[];
  assert(Array.isArray(cases) && cases.length > 0, 'Regression dataset must contain at least one case');

  const classifier = new Classifier(new DatasetProvider());
  for (const testCase of cases) {
    const result = await classifier.classify(testCase.message, []);
    assert(
      result.level === testCase.expectedLevel,
      `Regression mismatch for "${testCase.message}". expected ${testCase.expectedLevel}, got ${result.level}`
    );
  }
  console.log(`Regression dataset gate passed (${cases.length} cases).`);
}

run().catch((error) => {
  console.error('Regression dataset gate failed:', error);
  process.exitCode = 1;
});
