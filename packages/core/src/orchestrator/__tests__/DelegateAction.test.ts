import { AmplifierLoop } from '../AmplifierLoop.js';
import { CapabilityResolver } from '../CapabilityResolver.js';
import { runActPhase } from '../amplifier/AmplifierActPhase.js';
import type { AvailableCapabilities, ResolvedAction } from '../types.js';
import { AVAILABLE_TOOLS, ComplexityLevel } from '../types.js';
import { CompletionRequest, CompletionResponse, LLMProvider } from '../../providers/types.js';
import { createDefaultAmplifierLoopLog } from '../amplifier/AmplifierLoopLog.js';
import type { AgentRouter } from '../AgentRouter.js';

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
  const routerCalls: { agent: string; task: string; context: string }[] = [];
  const router: AgentRouter = {
    async delegate(agent: string, task: string, context: string) {
      routerCalls.push({ agent, task, context });
      return 'DELEGATE_RESULT';
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
  const observe = result.stepsUsed.filter((s) => s.type === 'observe');
  const injected = observe.find((s) => s.output?.includes('DELEGATE_RESULT'));
  assert(!!injected, 'loop: should inject observe with delegate result');
  assert(
    Boolean(injected!.output?.includes('Agent claude_code completed the task:')),
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

async function runTests() {
  console.log('DelegateAction tests\n');
  await testResolver();
  await testActPhase();
  await testAmplifierLoopIntegration();
  console.log('\nAll delegate action tests passed.');
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
