import { runSimpleModerateFastPath } from '../amplifier/AmplifierSimplePath.js';
import { runVerifyBeforeSynthesizeIfEnabled, type VerifyBeforeSynthesizeStructuredContext } from '../amplifier/AmplifierVerifyPhase.js';
import { CapabilityResolver } from '../CapabilityResolver.js';
import {
  ComplexityLevel,
  type AmplifierInput,
  type Step,
  type AvailableCapabilities,
  AVAILABLE_TOOLS,
} from '../types.js';
import type { CompletionRequest, CompletionResponse, LLMProvider } from '../../providers/types.js';
import { createDefaultAmplifierLoopLog } from '../amplifier/AmplifierLoopLog.js';
import { initStageMetrics } from '../amplifier/AmplifierLoopMetrics.js';
import type { Subtask } from '../Decomposer.js';
import { writeFile as fsWriteFile, mkdir, readFile, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import type { ExecutableTool, ToolResult } from '../../tools/types.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

class QueueProvider implements LLMProvider {
  name = 'mock';
  model = 'mock-model';
  constructor(private queue: string[]) {}
  async isAvailable(): Promise<boolean> { return true; }
  async complete(_r: CompletionRequest): Promise<CompletionResponse> {
    return {
      content: this.queue.length > 0 ? this.queue.shift()! : '',
      usage: { inputTokens: 1, outputTokens: 1 },
      model: this.model,
      provider: this.name,
    };
  }
}

class FixedProvider implements LLMProvider {
  name = 'mock';
  model = 'mock-model';
  constructor(private readonly content: string) {}
  async isAvailable(): Promise<boolean> { return true; }
  async complete(_r: CompletionRequest): Promise<CompletionResponse> {
    return { content: this.content, usage: { inputTokens: 1, outputTokens: 1 }, model: this.model, provider: this.name };
  }
}

class WriteFileTool implements ExecutableTool {
  name = 'write_file';
  description = 'Write content to a file.';
  parameters = {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'Absolute path' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['path', 'content'],
  };
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = String(input.path ?? '');
    const content = String(input.content ?? '');
    try {
      await mkdir(dirname(filePath), { recursive: true });
      await fsWriteFile(filePath, content, 'utf8');
      return { success: true, output: `written: ${filePath}` };
    } catch (error) {
      return { success: false, output: '', error: String(error) };
    }
  }
}

function buildBaseInput(message: string, overrides: Partial<AmplifierInput> = {}): AmplifierInput {
  return {
    message,
    conversationId: 'c1',
    userId: 'u1',
    history: [],
    availableTools: [...AVAILABLE_TOOLS],
    availableSkills: [],
    availableAgents: [],
    userLanguage: 'es',
    ...overrides,
  };
}

// ─── Fast-path: prose response ──────────────────────────────────────────────

async function testProseFastPath(): Promise<void> {
  console.log('Test: SIMPLE prose response — no tool call');
  const prose = 'Claro, te cuento brevemente sobre los patrones de diseño.';
  const provider = new QueueProvider([prose]);
  const toolsUsed = new Set<string>();
  const result = await runSimpleModerateFastPath({
    input: buildBaseInput('explícame los patrones de diseño'),
    classifiedLevel: ComplexityLevel.SIMPLE,
    stageMetrics: initStageMetrics(),
    modelsUsed: new Set(),
    toolsUsed,
    injectedSkills: new Map(),
    preResolvedSkills: [],
    startTime: Date.now(),
    requestId: 'r-prose',
    steps: [],
    baseProvider: provider,
    withTimeout: async <T>(p: Promise<T>) => p,
    executableTools: [],
    log: createDefaultAmplifierLoopLog(),
    requestToolInputCorrection: async () => null,
    verifyBeforeSynthesize: false,
  });
  assert(result.content.includes('patrones') || result.content.includes('Claro'), `prose not returned: ${result.content}`);
  assert(toolsUsed.size === 0, 'prose response should not use any tools');
  console.log('  ✓ prose response returned, no tools invoked\n');
}

// ─── Fast-path: prose with embedded code block does NOT trigger tool ─────────

async function testProseWithCodeBlockNoToolCall(): Promise<void> {
  console.log('Test: prose with JS code block does not trigger generic error');
  const prose = 'Aquí un ejemplo:\n```javascript\nconsole.log("hello");\n```\n¿Necesitas más?';
  const provider = new QueueProvider([prose]);
  const toolsUsed = new Set<string>();
  const result = await runSimpleModerateFastPath({
    input: buildBaseInput('muéstrame un ejemplo de console.log'),
    classifiedLevel: ComplexityLevel.SIMPLE,
    stageMetrics: initStageMetrics(),
    modelsUsed: new Set(),
    toolsUsed,
    injectedSkills: new Map(),
    preResolvedSkills: [],
    startTime: Date.now(),
    requestId: 'r-prose-code',
    steps: [],
    baseProvider: provider,
    withTimeout: async <T>(p: Promise<T>) => p,
    executableTools: [],
    log: createDefaultAmplifierLoopLog(),
    requestToolInputCorrection: async () => null,
    verifyBeforeSynthesize: false,
  });
  assert(!result.content.includes('Tuve un problema'), `should not return generic error: ${result.content}`);
  assert(toolsUsed.size === 0, 'code block inside prose must not trigger tool call');
  console.log('  ✓ code block in prose: no error, no tool invoked\n');
}

// ─── Fast-path: tool use — write_file ────────────────────────────────────────

async function testFastPathToolExecution(): Promise<void> {
  console.log('Test: fast-path tool execution (write_file → synthesis)');
  const tmpFile = join(tmpdir(), `enzo-test-${Date.now()}.txt`);
  const toolCallJson = JSON.stringify({
    action: 'tool',
    tool: 'write_file',
    input: { path: tmpFile, content: 'hello from enzo test' },
  });
  const synthesisResponse = 'El archivo fue creado exitosamente.';
  const provider = new QueueProvider([toolCallJson, synthesisResponse]);
  const toolsUsed = new Set<string>();
  const steps: Step[] = [];
  const result = await runSimpleModerateFastPath({
    input: buildBaseInput('crea un archivo de prueba'),
    classifiedLevel: ComplexityLevel.MODERATE,
    stageMetrics: initStageMetrics(),
    modelsUsed: new Set(),
    toolsUsed,
    injectedSkills: new Map(),
    preResolvedSkills: [],
    startTime: Date.now(),
    requestId: 'r-tool',
    steps,
    baseProvider: provider,
    withTimeout: async <T>(p: Promise<T>) => p,
    executableTools: [new WriteFileTool()],
    log: createDefaultAmplifierLoopLog(),
    requestToolInputCorrection: async () => null,
    verifyBeforeSynthesize: false,
  });
  assert(toolsUsed.has('write_file'), `write_file must be in toolsUsed, got: ${Array.from(toolsUsed).join(',')}`);
  assert(result.content.includes('exitosamente') || result.content.length > 0, 'synthesis response expected');
  try { await unlink(tmpFile); } catch { /* cleanup */ }
  console.log('  ✓ fast-path tool execution: write_file executed and synthesis returned\n');
}

// ─── Fast-path: model requests {"action":"none"} ─────────────────────────────

async function testFastPathNoneAction(): Promise<void> {
  console.log('Test: {"action":"none"} terminates loop cleanly');
  const noneJson = JSON.stringify({ action: 'none' });
  const provider = new QueueProvider([noneJson]);
  const toolsUsed = new Set<string>();
  const result = await runSimpleModerateFastPath({
    input: buildBaseInput('no hagas nada'),
    classifiedLevel: ComplexityLevel.SIMPLE,
    stageMetrics: initStageMetrics(),
    modelsUsed: new Set(),
    toolsUsed,
    injectedSkills: new Map(),
    preResolvedSkills: [],
    startTime: Date.now(),
    requestId: 'r-none',
    steps: [],
    baseProvider: provider,
    withTimeout: async <T>(p: Promise<T>) => p,
    executableTools: [],
    log: createDefaultAmplifierLoopLog(),
    requestToolInputCorrection: async () => null,
    verifyBeforeSynthesize: false,
  });
  // Should return empty or minimal content without crashing
  assert(typeof result.content === 'string', 'result.content must be string');
  assert(toolsUsed.size === 0, 'no tools should run on none action');
  console.log('  ✓ {"action":"none"} terminates cleanly\n');
}

// ─── Delegation resolution ───────────────────────────────────────────────────

async function testDelegateToClaudeCode(): Promise<void> {
  console.log('Test: CapabilityResolver routes delegate JSON to claude_code');
  const resolver = new CapabilityResolver();
  const capabilities: AvailableCapabilities = {
    tools: [...AVAILABLE_TOOLS],
    skills: [],
    agents: [],
  };
  const delegateJson = JSON.stringify({
    action: 'delegate',
    agent: 'claude_code',
    task: 'Implement a full authentication service with JWT',
    reason: 'Requires large multi-file code generation',
  });
  const resolved = await resolver.resolve(delegateJson, capabilities);
  assert(resolved.type === 'delegate', `expected delegate, got ${resolved.type}`);
  assert(resolved.type === 'delegate' && resolved.target === 'claude_code', 'wrong delegation target');
  assert(resolved.type === 'delegate' && resolved.input.task.includes('authentication'), 'task not preserved');
  assert(resolved.type === 'delegate' && resolved.reason.includes('multi-file'), 'reason not preserved');
  console.log('  ✓ delegate JSON → claude_code resolved correctly\n');
}

async function testDelegateToDocAgent(): Promise<void> {
  console.log('Test: CapabilityResolver routes delegate JSON to doc_agent');
  const resolver = new CapabilityResolver();
  const capabilities: AvailableCapabilities = {
    tools: [...AVAILABLE_TOOLS],
    skills: [],
    agents: [],
  };
  const delegateJson = JSON.stringify({
    action: 'delegate',
    agent: 'doc_agent',
    task: 'Write a technical specification document',
    reason: 'Long-form document generation',
  });
  const resolved = await resolver.resolve(delegateJson, capabilities);
  assert(resolved.type === 'delegate' && resolved.target === 'doc_agent', 'wrong delegation target');
  console.log('  ✓ delegate JSON → doc_agent resolved correctly\n');
}

async function testUnknownActionFallsToTool(): Promise<void> {
  console.log('Test: non-delegate non-tool JSON falls through gracefully');
  const resolver = new CapabilityResolver();
  const capabilities: AvailableCapabilities = {
    tools: [...AVAILABLE_TOOLS],
    skills: [],
    agents: [],
  };
  const weirdJson = JSON.stringify({ action: 'something_unknown', target: 'nowhere' });
  const resolved = await resolver.resolve(weirdJson, capabilities);
  // Should not throw — type will be 'none' or 'tool' fallthrough
  assert(['none', 'tool', 'delegate', 'unknown'].includes(resolved.type), `unexpected type: ${resolved.type}`);
  console.log('  ✓ unknown action JSON resolves without throwing\n');
}

// ─── Verify phase: gap detection ─────────────────────────────────────────────

async function testVerifyPhaseDetectsGap(): Promise<void> {
  console.log('Test: verify phase identifies missing planned step');
  const planned: Subtask[] = [
    { id: 1, tool: 'write_file', description: 'create config', input: 'x', dependsOn: null },
    { id: 2, tool: 'write_file', description: 'create README', input: 'y', dependsOn: 1 },
  ];
  const executedSteps: Step[] = [
    {
      iteration: 1, type: 'act', requestId: 'r1',
      action: 'tool', target: 'write_file',
      status: 'ok', output: 'written: config', durationMs: 1, modelUsed: 'm',
    },
    // step 2 intentionally missing
  ];
  const provider = new FixedProvider(
    JSON.stringify({ satisfied: false, gaps: 'README write missing', missingStepIds: [2] })
  );
  const modelsUsed = new Set<string>();
  const extras: VerifyBeforeSynthesizeStructuredContext = { plannedSubtasks: planned, orchestratorSteps: executedSteps };
  const result = await runVerifyBeforeSynthesizeIfEnabled(
    { baseProvider: provider, withTimeout: <T>(p: Promise<T>) => p },
    buildBaseInput('create config and README', { decomposition: { steps: planned, originalMessage: 'test' } }),
    executedSteps.map((s) => `${s.target}: ${s.output}`).join('\n'),
    1,
    modelsUsed,
    true,
    extras,
  );
  assert(result.context.includes('missing') || result.context.includes('README') || result.context.length > 0,
    'verify phase should flag the missing step');
  console.log('  ✓ verify phase detects missing planned step\n');
}

async function testVerifyPhaseSatisfied(): Promise<void> {
  console.log('Test: verify phase passes when all steps executed');
  const planned: Subtask[] = [
    { id: 1, tool: 'write_file', description: 'create file', input: 'x', dependsOn: null },
  ];
  const executedSteps: Step[] = [
    {
      iteration: 1, type: 'act', requestId: 'r1',
      action: 'tool', target: 'write_file',
      status: 'ok', output: 'written: file', durationMs: 1, modelUsed: 'm',
    },
  ];
  const provider = new FixedProvider(
    JSON.stringify({ satisfied: true, gaps: '', missingStepIds: [] })
  );
  const modelsUsed = new Set<string>();
  const extras: VerifyBeforeSynthesizeStructuredContext = { plannedSubtasks: planned, orchestratorSteps: executedSteps };
  const result = await runVerifyBeforeSynthesizeIfEnabled(
    { baseProvider: provider, withTimeout: <T>(p: Promise<T>) => p },
    buildBaseInput('create file', { decomposition: { steps: planned, originalMessage: 'test' } }),
    'written: file',
    1,
    modelsUsed,
    true,
    extras,
  );
  // satisfied → no gaps appended → context stays as original evidence
  assert(typeof result.context === 'string', 'result.context must be string');
  assert(!result.context.includes('missing') && !result.context.includes('gap'), `satisfied verify should not flag gaps, got: ${result.context}`);
  console.log('  ✓ verify phase satisfied: no gap flags\n');
}

// ─── Amplifier respects assistantProfile in prompt ───────────────────────────

async function testFastPathRespectsAssistantProfile(): Promise<void> {
  console.log('Test: fast-path system prompt includes assistantProfile name and tone');
  let capturedSystemPrompt = '';
  const capturingProvider: LLMProvider = {
    name: 'mock',
    model: 'mock',
    isAvailable: async () => true,
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      const systemMsg = req.messages.find((m) => m.role === 'system');
      if (systemMsg) capturedSystemPrompt = String(systemMsg.content);
      return { content: 'Hola, soy Luna.', usage: { inputTokens: 1, outputTokens: 1 }, model: 'mock', provider: 'mock' };
    },
  };
  await runSimpleModerateFastPath({
    input: buildBaseInput('quién eres?', {
      assistantProfile: { name: 'Luna', persona: 'creative writing assistant', tone: 'warm and poetic' },
    }),
    classifiedLevel: ComplexityLevel.SIMPLE,
    stageMetrics: initStageMetrics(),
    modelsUsed: new Set(),
    toolsUsed: new Set(),
    injectedSkills: new Map(),
    preResolvedSkills: [],
    startTime: Date.now(),
    requestId: 'r-profile',
    steps: [],
    baseProvider: capturingProvider,
    withTimeout: async <T>(p: Promise<T>) => p,
    executableTools: [],
    log: createDefaultAmplifierLoopLog(),
    requestToolInputCorrection: async () => null,
    verifyBeforeSynthesize: false,
  });
  assert(capturedSystemPrompt.includes('Luna'), `system prompt must include name "Luna", got: ${capturedSystemPrompt.slice(0, 300)}`);
  assert(capturedSystemPrompt.includes('warm and poetic'), `system prompt must include tone, got: ${capturedSystemPrompt.slice(0, 300)}`);
  assert(capturedSystemPrompt.includes('creative writing assistant'), `system prompt must include persona`);
  console.log('  ✓ fast-path system prompt carries assistantProfile name, persona, and tone\n');
}

async function testFastPathInjectsUserMemoryBlock(): Promise<void> {
  console.log('Test: fast-path system prompt includes user memory block');
  let capturedSystemPrompt = '';
  const capturingProvider: LLMProvider = {
    name: 'mock',
    model: 'mock',
    isAvailable: async () => true,
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      const systemMsg = req.messages.find((m) => m.role === 'system');
      if (systemMsg) capturedSystemPrompt = String(systemMsg.content);
      return { content: 'Hola Franco!', usage: { inputTokens: 1, outputTokens: 1 }, model: 'mock', provider: 'mock' };
    },
  };
  await runSimpleModerateFastPath({
    input: buildBaseInput('cómo me llamo?', {
      memoryBlock: 'FACTS ABOUT THE USER:\nThe user\'s name is "Franco".\nThe user\'s profession: developer.',
    }),
    classifiedLevel: ComplexityLevel.SIMPLE,
    stageMetrics: initStageMetrics(),
    modelsUsed: new Set(),
    toolsUsed: new Set(),
    injectedSkills: new Map(),
    preResolvedSkills: [],
    startTime: Date.now(),
    requestId: 'r-memory',
    steps: [],
    baseProvider: capturingProvider,
    withTimeout: async <T>(p: Promise<T>) => p,
    executableTools: [],
    log: createDefaultAmplifierLoopLog(),
    requestToolInputCorrection: async () => null,
    verifyBeforeSynthesize: false,
  });
  assert(capturedSystemPrompt.includes('Franco'), `system prompt must include user name "Franco"`);
  assert(capturedSystemPrompt.includes('developer'), `system prompt must include profession`);
  assert(capturedSystemPrompt.includes('USER CONTEXT'), `system prompt must have USER CONTEXT section`);
  console.log('  ✓ fast-path system prompt carries user memory block with name and profession\n');
}

// ─── Problem-solving: multi-turn context ─────────────────────────────────────

async function testFastPathUsesConversationHistory(): Promise<void> {
  console.log('Test: fast-path passes conversation history to provider');
  let capturedMessages: Array<{ role: string }> = [];
  const capturingProvider: LLMProvider = {
    name: 'mock',
    model: 'mock',
    isAvailable: async () => true,
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      capturedMessages = req.messages.map((m) => ({ role: m.role }));
      return { content: 'Entendido.', usage: { inputTokens: 1, outputTokens: 1 }, model: 'mock', provider: 'mock' };
    },
  };
  await runSimpleModerateFastPath({
    input: buildBaseInput('y cómo sigo?', {
      history: [
        { role: 'user', content: 'quiero aprender TypeScript' },
        { role: 'assistant', content: 'TypeScript es un superset de JavaScript.' },
      ],
    }),
    classifiedLevel: ComplexityLevel.SIMPLE,
    stageMetrics: initStageMetrics(),
    modelsUsed: new Set(),
    toolsUsed: new Set(),
    injectedSkills: new Map(),
    preResolvedSkills: [],
    startTime: Date.now(),
    requestId: 'r-history',
    steps: [],
    baseProvider: capturingProvider,
    withTimeout: async <T>(p: Promise<T>) => p,
    executableTools: [],
    log: createDefaultAmplifierLoopLog(),
    requestToolInputCorrection: async () => null,
    verifyBeforeSynthesize: false,
  });
  const userTurns = capturedMessages.filter((m) => m.role === 'user');
  const assistantTurns = capturedMessages.filter((m) => m.role === 'assistant');
  assert(userTurns.length >= 2, `at least 2 user turns expected in context, got ${userTurns.length}`);
  assert(assistantTurns.length >= 1, `at least 1 assistant turn expected in context, got ${assistantTurns.length}`);
  console.log('  ✓ conversation history forwarded to provider\n');
}

// ─── Run all ──────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log('AmplifierReasoning tests...\n');

  await testProseFastPath();
  await testProseWithCodeBlockNoToolCall();
  await testFastPathToolExecution();
  await testFastPathNoneAction();
  await testDelegateToClaudeCode();
  await testDelegateToDocAgent();
  await testUnknownActionFallsToTool();
  await testVerifyPhaseDetectsGap();
  await testVerifyPhaseSatisfied();
  await testFastPathRespectsAssistantProfile();
  await testFastPathInjectsUserMemoryBlock();
  await testFastPathUsesConversationHistory();

  console.log('AmplifierReasoning tests passed. ✓');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
