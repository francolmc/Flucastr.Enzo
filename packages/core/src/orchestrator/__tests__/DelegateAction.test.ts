import { AmplifierLoop } from '../AmplifierLoop.js';
import { CapabilityResolver } from '../CapabilityResolver.js';
import { runActPhase } from '../amplifier/AmplifierActPhase.js';
import type { AvailableCapabilities, ResolvedAction } from '../types.js';
import { AVAILABLE_TOOLS, ComplexityLevel } from '../types.js';
import { CompletionRequest, CompletionResponse, LLMProvider } from '../../providers/types.js';
import { createDefaultAmplifierLoopLog } from '../amplifier/AmplifierLoopLog.js';
import type { AgentRouterContract, DelegationRequest, DelegationResult } from '../AgentRouter.js';

const delegateThinkJson = JSON.stringify({
  action: 'delegate',
  agent: 'claude_code',
  task: 'Build a 100-line service with tests',
  reason: 'Exceeds tool-only execution scope for this run',
});

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
    const content = this.queue.length > 0 ? this.queue.shift()! : '{}';
    return {
      content,
      usage: { inputTokens: 1, outputTokens: 1 },
      model: this.model,
      provider: this.name,
    };
  }
}

async function testResolver() {
  const resolver = new CapabilityResolver();
  const capabilities: AvailableCapabilities = {
    tools: [...AVAILABLE_TOOLS],
    skills: [],
    agents: [],
  };
  const r = await resolver.resolve(delegateThinkJson, capabilities);
  assert(r.type === 'delegate', `resolver: expected delegate, got ${r.type}`);
  assert(r.type === 'delegate' && r.target === 'claude_code', 'resolver: wrong target');
  assert(
    r.type === 'delegate' && r.input.task.includes('100-line'),
    'resolver: task not preserved'
  );
  assert(
    r.type === 'delegate' && r.reason.includes('Exceeds'),
    'resolver: reason not preserved'
  );
  console.log('✓ CapabilityResolver: delegate JSON → ResolvedAction type delegate');
}

async function testActPhase() {
  const resolved: ResolvedAction = {
    type: 'delegate',
    target: 'doc_agent',
    reason: 'Need executive doc',
    input: { task: 'Write a 10-page report' },
  };
  const out = await runActPhase(
    {
      baseProvider: { model: 'm', name: 'n' } as LLMProvider,
      executableTools: [],
      log: createDefaultAmplifierLoopLog(),
    },
    resolved,
    1,
    new Set(),
    new Set()
  );
  assert(out.kind === 'delegate', 'act: kind delegate');
  assert(out.kind === 'delegate' && out.agent === 'doc_agent' && out.task === 'Write a 10-page report', 'act: payload');
  console.log('✓ runActPhase: returns delegate signal (no tool execution)');
}

async function testAmplifierLoopIntegration() {
  const delegateQueue = [delegateThinkJson, '{"action":"none"}', 'final reply for user'];
  const provider = new QueueProvider(delegateQueue);
  const routerCalls: DelegationRequest[] = [];
  const router: AgentRouterContract = {
    async delegate(request: DelegationRequest): Promise<DelegationResult> {
      routerCalls.push(request);
      return { success: true, agent: request.agent, output: 'DELEGATE_RESULT' };
    },
  };
  const loop = new AmplifierLoop(provider, [], {
    log: createDefaultAmplifierLoopLog(),
    maxIterations: 4,
    verifyBeforeSynthesize: false,
    agentRouter: router,
  });
  const result = await loop.amplify({
    message: 'do something very large',
    conversationId: 'c1',
    userId: 'u1',
    history: [],
    availableTools: [...AVAILABLE_TOOLS],
    availableSkills: [],
    availableAgents: [],
    classifiedLevel: ComplexityLevel.AGENT,
  });
  assert(routerCalls.length === 1, 'loop: router should be called once');
  assert(routerCalls[0]!.agent === 'claude_code', 'loop: wrong agent to router');
  assert(routerCalls[0]!.task.includes('100-line'), 'loop: wrong task to router');
  assert(routerCalls[0]!.context.userId === 'u1', 'loop: userId in delegation context');
  const observe = result.stepsUsed.filter((s) => s.type === 'observe');
  const injected = observe.find((s) => s.output?.includes('DELEGATE_RESULT'));
  assert(!!injected, 'loop: should inject observe with delegate result');
  assert(
    Boolean(injected!.output?.includes('Agent claude_code completed: DELEGATE_RESULT')),
    'loop: expected observe text prefix'
  );
  const thinkSteps = result.stepsUsed.filter((s) => s.type === 'think');
  assert(thinkSteps.length >= 2, 'loop: should continue to another THINK after delegate');
  assert(
    (result.content ?? '').includes('final') || (result.content ?? '').length > 0,
    'loop: should return synthesized content'
  );
  console.log('✓ AmplifierLoop: router → observe → further THINK');
}

async function testImagePayloadCoercesDelegateWhenThinkIsProseOnly() {
  const proseOnly =
    'Entendido, Franco. Dime cuál es el contenido de la imagen y estaré encantado de ayudarte.';
  const provider = new QueueProvider([proseOnly, '{"action":"none"}', 'Synth done.']);
  let delegatedAgent = '';
  let delegatedTask = '';
  const router: AgentRouterContract = {
    async delegate(request: DelegationRequest): Promise<DelegationResult> {
      delegatedAgent = request.agent;
      delegatedTask = request.task;
      return { success: true, agent: request.agent, output: 'VIS_OK_DETAIL' };
    },
  };
  const loop = new AmplifierLoop(provider, [], {
    log: createDefaultAmplifierLoopLog(),
    maxIterations: 8,
    verifyBeforeSynthesize: false,
    agentRouter: router,
  });
  const hostMessage = `[Franco mandó una imagen: x.jpg]
Está guardado en /tmp/x.jpg.

Instrucción del usuario (caption): ¿qué ves en la imagen?`;
  const result = await loop.amplify({
    message: hostMessage,
    conversationId: 'c-img',
    userId: 'u1',
    history: [],
    availableTools: [...AVAILABLE_TOOLS],
    availableSkills: [],
    availableAgents: [],
    classifiedLevel: ComplexityLevel.MODERATE,
    delegationHint: { agentId: 'vision_agent', reason: 'user requested image analysis' },
    imageContext: { base64: 'AABBCCEEZZ', mimeType: 'image/jpeg' },
  });
  assert(delegatedAgent === 'vision_agent', `delegate agent: ${delegatedAgent}`);
  assert(
    delegatedTask.includes('¿qué ves') || delegatedTask.includes('qué ves'),
    `task should carry caption; got ${delegatedTask}`
  );
  assert(
    result.stepsUsed.some((s) => s.type === 'observe' && s.output?.includes('VIS_OK_DETAIL')),
    'observe should reflect vision delegation'
  );
  console.log('✓ AmplifierLoop: imageContext + prose THINK → coerced delegate');
}

async function runTests() {
  console.log('DelegateAction tests\n');
  await testResolver();
  await testActPhase();
  await testAmplifierLoopIntegration();
  await testImagePayloadCoercesDelegateWhenThinkIsProseOnly();
  console.log('\nAll delegate action tests passed.');
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
