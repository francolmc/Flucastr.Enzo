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
import { writeFile as fsWriteFile, mkdir, readFile, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import type { ExecutableTool, ToolResult } from '../../tools/types.js';

class WriteFileTool implements ExecutableTool {
  name = 'write_file';
  description = 'Write content to a file.';
  parameters = { type: 'object' as const, properties: { path: { type: 'string', description: 'Absolute path' }, content: { type: 'string', description: 'Content to write' } }, required: ['path', 'content'] };
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = String(input.path ?? '');
    const content = String(input.content ?? '');
    try {
      await mkdir(dirname(filePath), { recursive: true });
      await fsWriteFile(filePath, content, 'utf8');
      return { success: true, output: `File written: ${filePath}` };
    } catch (error) {
      return { success: false, output: '', error: `Cannot write file: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
}

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

async function testPersistRecoveryWritesDiskWhenModelReturnsProse() {
  const testPath = join(tmpdir(), `enzo-persist-recovery-${Date.now()}.md`);
  const fileBody = '# Historia recuperada\n\nLínea de prueba.';
  const queue = [
    'Aquí tienes la historia pedida; el archivo ya quedó creado en disco con todo el contenido.',
    'Sigamos charlando sobre la historia sin JSON.',
    fileBody,
    'Listo — el archivo fue escrito correctamente.',
  ];

  try {
    const provider = new QueueProvider(queue);
    const toolsUsed = new Set<string>();
    const modelsUsed = new Set<string>();
    const steps: Step[] = [];
    const injectedSkills = new Map();
    const result = await runSimpleModerateFastPath({
      input: buildBaseInput(`crear el archivo ${testPath} con una historia corta de prueba`),
      classifiedLevel: ComplexityLevel.MODERATE,
      stageMetrics: initStageMetrics(),
      modelsUsed,
      toolsUsed,
      injectedSkills,
      preResolvedSkills: [],
      startTime: Date.now(),
      requestId: 'r1',
      steps,
      baseProvider: provider,
      withTimeout: async <T>(p: Promise<T>) => p,
      executableTools: [new WriteFileTool()],
      log: createDefaultAmplifierLoopLog(),
      requestToolInputCorrection: async () => null,
      verifyBeforeSynthesize: false,
    });

    assert(result.toolsUsed.includes('write_file'), 'expected write_file after persist recovery');
    const onDisk = await readFile(testPath, 'utf8');
    assert(onDisk === fileBody, `file body mismatch: ${JSON.stringify(onDisk)}`);
    console.log('✓ persist recovery: prose model → write_file on disk');
  } finally {
    await unlink(testPath).catch(() => {});
  }
}

async function testDirectWriteFileJsonSkipsRecovery() {
  const testPath = join(tmpdir(), `enzo-persist-direct-${Date.now()}.md`);
  const fileBody = '# Directo\n\nOK.';
  const writeJson = JSON.stringify({
    action: 'tool',
    tool: 'write_file',
    input: { path: testPath, content: fileBody },
  });

  try {
    const provider = new QueueProvider([writeJson, 'Archivo guardado.']);
    const toolsUsed = new Set<string>();
    const modelsUsed = new Set<string>();
    const steps: Step[] = [];
    const injectedSkills = new Map();
    await runSimpleModerateFastPath({
      input: buildBaseInput(`guardar en ${testPath} el contenido de prueba`),
      classifiedLevel: ComplexityLevel.MODERATE,
      stageMetrics: initStageMetrics(),
      modelsUsed,
      toolsUsed,
      injectedSkills,
      preResolvedSkills: [],
      startTime: Date.now(),
      requestId: 'r2',
      steps,
      baseProvider: provider,
      withTimeout: async <T>(p: Promise<T>) => p,
      executableTools: [new WriteFileTool()],
      log: createDefaultAmplifierLoopLog(),
      requestToolInputCorrection: async () => null,
      verifyBeforeSynthesize: false,
    });

    assert(toolsUsed.has('write_file'), 'expected single-shot write_file');
    assert((await readFile(testPath, 'utf8')) === fileBody, 'direct JSON write body');
    console.log('✓ fast path: valid write_file JSON → one tool call, no extra recovery queue');
  } finally {
    await unlink(testPath).catch(() => {});
  }
}

async function runTests() {
  console.log('Running AmplifierSimplePath persist tests...\n');
  await testPersistRecoveryWritesDiskWhenModelReturnsProse();
  await testDirectWriteFileJsonSkipsRecovery();
  console.log('\nAll AmplifierSimplePath persist tests passed.');
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
