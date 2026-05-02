import { runSimpleModerateFastPath } from '../amplifier/AmplifierSimplePath.js';
import {
  ComplexityLevel,
  type AmplifierInput,
  type Step,
  AVAILABLE_TOOLS,
} from '../types.js';
import { CompletionRequest, CompletionResponse, LLMProvider } from '../../providers/types.js';
import { createDefaultAmplifierLoopLog } from '../amplifier/AmplifierLoopLog.js';
import { initStageMetrics } from '../amplifier/AmplifierLoopMetrics.js';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

class QueueProvider implements LLMProvider {
  name = 'mock';
  model = 'mock-model';

  constructor(private queue: string[]) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async complete(_request: CompletionRequest): Promise<CompletionResponse> {
    const content = this.queue.length > 0 ? this.queue.shift()! : '';
    return {
      content,
      usage: { inputTokens: 1, outputTokens: 1 },
      model: this.model,
      provider: this.name,
    };
  }
}

function buildBaseInput(message: string): AmplifierInput {
  return {
    message,
    conversationId: 'c1',
    userId: 'u1',
    history: [],
    availableTools: [...AVAILABLE_TOOLS],
    availableSkills: [],
    availableAgents: [],
    userLanguage: 'es',
  };
}

const GENERIC_ERROR = 'Tuve un problema procesando tu solicitud. ¿Podés reformularla?';

async function testProseWithJsCodeBlockDoesNotEmitGenericError() {
  const proseWithJsCode =
    '¡Genial! Vamos a registrar un proyecto llamado "Enzo".\n\n' +
    'Primero, creemos un script básico:\n\n' +
    '```javascript\n' +
    "const { chromium } = require('playwright');\n" +
    '(async () => {\n' +
    '  const browser = await chromium.launch();\n' +
    '  const page = await browser.newPage();\n' +
    "  await page.goto('https://example.com');\n" +
    '  await browser.close();\n' +
    '})();\n' +
    '```\n\n' +
    '¿Necesitas ayuda con algo más?';

  const provider = new QueueProvider([proseWithJsCode]);
  const toolsUsed = new Set<string>();
  const modelsUsed = new Set<string>();
  const steps: Step[] = [];
  const injectedSkills = new Map();

  const result = await runSimpleModerateFastPath({
    input: buildBaseInput(
      'Antes de eso quiero que registremos un proyecto llamado Enzo, el cual corresponde a mi asistente que estamos desarrollando'
    ),
    classifiedLevel: ComplexityLevel.SIMPLE,
    stageMetrics: initStageMetrics(),
    modelsUsed,
    toolsUsed,
    injectedSkills,
    preResolvedSkills: [],
    startTime: Date.now(),
    requestId: 'r-prose-1',
    steps,
    baseProvider: provider,
    withTimeout: async <T>(p: Promise<T>) => p,
    executableTools: [],
    log: createDefaultAmplifierLoopLog(),
    requestToolInputCorrection: async () => null,
    verifyBeforeSynthesize: false,
  });

  assert(
    result.content !== GENERIC_ERROR,
    `expected prose response, got generic error message: ${JSON.stringify(result.content)}`
  );
  assert(
    result.content.includes('¡Genial!') || result.content.includes('registrar un proyecto'),
    `expected prose content to be served back, got: ${JSON.stringify(result.content.slice(0, 200))}`
  );
  assert(
    toolsUsed.size === 0,
    `expected no tools to run for non-canonical embedded JSON, got: ${Array.from(toolsUsed).join(',')}`
  );
  console.log('✓ SIMPLE prose with JS code block → returns prose, not generic error');
}

async function testCanonicalToolJsonStillRoutes() {
  const canonical = JSON.stringify({
    action: 'tool',
    tool: 'unknown_tool_should_fall_through',
    input: { foo: 'bar' },
  });

  const provider = new QueueProvider([canonical]);
  const toolsUsed = new Set<string>();
  const modelsUsed = new Set<string>();
  const steps: Step[] = [];
  const injectedSkills = new Map();

  const result = await runSimpleModerateFastPath({
    input: buildBaseInput('hacé algo raro'),
    classifiedLevel: ComplexityLevel.SIMPLE,
    stageMetrics: initStageMetrics(),
    modelsUsed,
    toolsUsed,
    injectedSkills,
    preResolvedSkills: [],
    startTime: Date.now(),
    requestId: 'r-prose-2',
    steps,
    baseProvider: provider,
    withTimeout: async <T>(p: Promise<T>) => p,
    executableTools: [],
    log: createDefaultAmplifierLoopLog(),
    requestToolInputCorrection: async () => null,
    verifyBeforeSynthesize: false,
  });

  assert(
    !result.content.startsWith('{'),
    `tool-call JSON must not be returned verbatim, got: ${JSON.stringify(result.content.slice(0, 120))}`
  );
  console.log('✓ SIMPLE canonical tool JSON → still parsed (not echoed as raw)');
}

async function testProseWithToolnamePrefixedNonExistingTool() {
  const proseLooksLikeToolnamePattern =
    "playwight {\n  const browser = await playwight.launch();\n  await browser.close();\n}";

  const provider = new QueueProvider([proseLooksLikeToolnamePattern]);
  const toolsUsed = new Set<string>();
  const modelsUsed = new Set<string>();
  const steps: Step[] = [];
  const injectedSkills = new Map();

  const result = await runSimpleModerateFastPath({
    input: buildBaseInput('cuéntame algo'),
    classifiedLevel: ComplexityLevel.SIMPLE,
    stageMetrics: initStageMetrics(),
    modelsUsed,
    toolsUsed,
    injectedSkills,
    preResolvedSkills: [],
    startTime: Date.now(),
    requestId: 'r-prose-3',
    steps,
    baseProvider: provider,
    withTimeout: async <T>(p: Promise<T>) => p,
    executableTools: [],
    log: createDefaultAmplifierLoopLog(),
    requestToolInputCorrection: async () => null,
    verifyBeforeSynthesize: false,
  });

  assert(
    result.content !== GENERIC_ERROR,
    `expected prose passthrough, got generic error: ${JSON.stringify(result.content)}`
  );
  assert(
    toolsUsed.size === 0,
    `expected no tool execution for non-existing tool prefix, got: ${Array.from(toolsUsed).join(',')}`
  );
  console.log('✓ SIMPLE prose "toolName{...}" pattern with unknown tool → no fake tool call, no generic error');
}

async function runTests() {
  console.log('Running AmplifierSimplePath prose-fallback tests...\n');
  await testProseWithJsCodeBlockDoesNotEmitGenericError();
  await testCanonicalToolJsonStillRoutes();
  await testProseWithToolnamePrefixedNonExistingTool();
  console.log('\nAll AmplifierSimplePath prose-fallback tests passed.');
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
