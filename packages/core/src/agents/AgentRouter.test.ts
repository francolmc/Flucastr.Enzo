import { AmplifierLoop } from '../orchestrator/AmplifierLoop.js';
import { ComplexityLevel, AVAILABLE_TOOLS, type AgentConfig } from '../orchestrator/types.js';
import { createDefaultAmplifierLoopLog } from '../orchestrator/amplifier/AmplifierLoopLog.js';
import type { MemoryService } from '../memory/MemoryService.js';
import type { CompletionRequest, CompletionResponse, LLMProvider } from '../providers/types.js';
import { AgentRouter } from './AgentRouter.js';
import type { AgentRouterContract, DelegationRequest, DelegationResult } from './AgentRouter.js';
import type { ClaudeCodeAgent } from './ClaudeCodeAgent.js';
import type { DocAgent } from './DocAgent.js';
import type { VisionAgent } from './VisionAgent.js';
import type { UserAgentRunner } from './UserAgentRunner.js';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

const delegateThinkJson = JSON.stringify({
  action: 'delegate',
  agent: 'claude_code',
  task: 'Build a service',
  reason: 'Needs code agent',
});

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

async function testClaudeCodeRoutesToExecute() {
  let lastTask: string | null = null;
  const claude = {
    async execute(request: DelegationRequest): Promise<DelegationResult> {
      lastTask = request.task;
      return { success: true, agent: 'claude_code', output: 'done' };
    },
  };
  const doc = {
    async execute(): Promise<DelegationResult> {
      return { success: false, agent: 'doc_agent', output: '', error: 'should not run' };
    },
  };
  const vision = {
    async execute(): Promise<DelegationResult> {
      return { success: false, agent: 'vision_agent', output: '', error: 'should not run' };
    },
  };
  const router = new AgentRouter({
    claudeCodeAgent: claude as unknown as ClaudeCodeAgent,
    docAgent: doc as unknown as DocAgent,
    visionAgent: vision as unknown as VisionAgent,
  });
  const r = await router.delegate({
    agent: 'claude_code',
    task: 't',
    reason: 'r',
    context: {
      userId: 'u1',
      memories: [],
      conversationSummary: 's',
    },
  });
  assert(r.success && r.output === 'done', 'expected claude_code result');
  assert(lastTask === 't', 'execute should receive task');
}

async function testDocAgentRoutesToExecute() {
  let called = false;
  const claude: Pick<ClaudeCodeAgent, 'execute'> = {
    async execute(): Promise<DelegationResult> {
      return { success: false, agent: 'claude_code', output: '', error: 'no' };
    },
  };
  const doc: Pick<DocAgent, 'execute'> = {
    async execute(): Promise<DelegationResult> {
      called = true;
      return { success: true, agent: 'doc_agent', output: 'docout' };
    },
  };
  const vision: Pick<VisionAgent, 'execute'> = {
    async execute(): Promise<DelegationResult> {
      return { success: false, agent: 'vision_agent', output: '', error: 'no' };
    },
  };
  const router = new AgentRouter({
    claudeCodeAgent: claude as unknown as ClaudeCodeAgent,
    docAgent: doc as unknown as DocAgent,
    visionAgent: vision as unknown as VisionAgent,
  });
  const r = await router.delegate({
    agent: 'doc_agent',
    task: 't2',
    reason: 'r2',
    context: { userId: 'u1', memories: [], conversationSummary: '' },
  });
  assert(called, 'doc execute should run');
  assert(r.output === 'docout', 'doc output');
}

async function testUserPresetRoutesToUserAgentRunner() {
  const claude: Pick<ClaudeCodeAgent, 'execute'> = {
    async execute(): Promise<DelegationResult> {
      return { success: false, agent: 'claude_code', output: '', error: 'no' };
    },
  };
  const doc: Pick<DocAgent, 'execute'> = {
    async execute(): Promise<DelegationResult> {
      return { success: false, agent: 'doc_agent', output: '', error: 'no' };
    },
  };
  const vision: Pick<VisionAgent, 'execute'> = {
    async execute(): Promise<DelegationResult> {
      return { success: false, agent: 'vision_agent', output: '', error: 'no' };
    },
  };
  let runnerAgentId = '';
  const userRunner = {
    async execute(_req: DelegationRequest, agent: AgentConfig): Promise<DelegationResult> {
      runnerAgentId = agent.id;
      return { success: true, agent: agent.id, output: 'preset-out' };
    },
  };
  const preset: AgentConfig = {
    id: 'user-preset-1',
    name: 'Visor',
    description: 'vision',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
  };
  const router = new AgentRouter({
    claudeCodeAgent: claude as unknown as ClaudeCodeAgent,
    docAgent: doc as unknown as DocAgent,
    visionAgent: vision as unknown as VisionAgent,
    resolveUserAgent: async (id) => (id === 'user-preset-1' ? preset : undefined),
    userAgentRunner: userRunner as unknown as UserAgentRunner,
  });
  const r = await router.delegate({
    agent: 'user-preset-1',
    task: 'describe image',
    reason: 'vision',
    context: { userId: 'u1', memories: [], conversationSummary: 's' },
  });
  assert(r.success && r.output === 'preset-out', JSON.stringify(r));
  assert(runnerAgentId === 'user-preset-1', 'runner received preset');
}

async function testUnknownAgentNoThrow() {
  const claude: Pick<ClaudeCodeAgent, 'execute'> = {
    async execute(): Promise<DelegationResult> {
      return { success: true, agent: 'claude_code', output: '' };
    },
  };
  const doc: Pick<DocAgent, 'execute'> = {
    async execute(): Promise<DelegationResult> {
      return { success: true, agent: 'doc_agent', output: '' };
    },
  };
  const vision: Pick<VisionAgent, 'execute'> = {
    async execute(): Promise<DelegationResult> {
      return { success: true, agent: 'vision_agent', output: '' };
    },
  };
  const router = new AgentRouter({
    claudeCodeAgent: claude as unknown as ClaudeCodeAgent,
    docAgent: doc as unknown as DocAgent,
    visionAgent: vision as unknown as VisionAgent,
  });
  const r = await router.delegate({
    agent: 'unknown_xyz',
    task: 't',
    reason: 'r',
    context: { userId: 'u1', memories: [], conversationSummary: '' },
  });
  assert(!r.success && Boolean(r.error?.includes('Unknown agent')), 'unknown agent error');
}

async function testNotifyRunsBeforeExecute() {
  const order: string[] = [];
  const claude: Pick<ClaudeCodeAgent, 'execute'> = {
    async execute(): Promise<DelegationResult> {
      order.push('execute');
      return { success: true, agent: 'claude_code', output: 'ok' };
    },
  };
  const doc: Pick<DocAgent, 'execute'> = {
    async execute(): Promise<DelegationResult> {
      return { success: true, agent: 'doc_agent', output: '' };
    },
  };
  const vision: Pick<VisionAgent, 'execute'> = {
    async execute(): Promise<DelegationResult> {
      return { success: true, agent: 'vision_agent', output: '' };
    },
  };
  const router = new AgentRouter({
    claudeCodeAgent: claude as unknown as ClaudeCodeAgent,
    docAgent: doc as unknown as DocAgent,
    visionAgent: vision as unknown as VisionAgent,
    notificationGateway: {
      notify: async () => {
        order.push('notify');
      },
    },
  });
  await router.delegate({
    agent: 'claude_code',
    task: 't',
    reason: 'r',
    context: { userId: 'u1', memories: [], conversationSummary: '' },
  });
  assert(order[0] === 'notify' && order[1] === 'execute', `expected notify then execute, got ${order.join(',')}`);
}

async function testVisionAgentRoutesToExecute() {
  let lastTask: string | null = null;
  const claude: Pick<ClaudeCodeAgent, 'execute'> = {
    async execute(): Promise<DelegationResult> {
      return { success: false, agent: 'claude_code', output: '', error: 'no' };
    },
  };
  const doc: Pick<DocAgent, 'execute'> = {
    async execute(): Promise<DelegationResult> {
      return { success: false, agent: 'doc_agent', output: '', error: 'no' };
    },
  };
  const vision: Pick<VisionAgent, 'execute'> = {
    async execute(request: DelegationRequest): Promise<DelegationResult> {
      lastTask = request.task;
      return { success: true, agent: 'vision_agent', output: 'saw a chart' };
    },
  };
  const router = new AgentRouter({
    claudeCodeAgent: claude as unknown as ClaudeCodeAgent,
    docAgent: doc as unknown as DocAgent,
    visionAgent: vision as unknown as VisionAgent,
  });
  const r = await router.delegate({
    agent: 'vision_agent',
    task: 'Describe axes',
    reason: 'Local model has no vision',
    context: {
      userId: 'u1',
      memories: [],
      conversationSummary: 's',
      imageBase64: 'abc',
      imageMimeType: 'image/jpeg',
    },
  });
  assert(r.success && r.output === 'saw a chart', JSON.stringify(r));
  assert(lastTask === 'Describe axes', 'vision task');
}

async function testMemoryAfterDelegationResult() {
  const rememberLog: string[] = [];
  const memoryService: Pick<MemoryService, 'remember'> = {
    async remember(_userId: string, _key: string, value: string): Promise<void> {
      rememberLog.push(value);
    },
  };

  const delegateQueue = [delegateThinkJson, '{"action":"none"}', 'final'];
  const provider = new QueueProvider(delegateQueue);
  const router: AgentRouterContract = {
    async delegate(request: DelegationRequest): Promise<DelegationResult> {
      return { success: true, agent: request.agent, output: 'OUT', filesCreated: ['/tmp/ws/x.md'] };
    },
  };

  const loop = new AmplifierLoop(provider, [], {
    log: createDefaultAmplifierLoopLog(),
    maxIterations: 4,
    verifyBeforeSynthesize: false,
    agentRouter: router,
    memoryService: memoryService as MemoryService,
  });

  await loop.amplify({
    message: 'large task',
    conversationId: 'c1',
    userId: 'u1',
    history: [],
    availableTools: [...AVAILABLE_TOOLS],
    availableSkills: [],
    availableAgents: [],
    classifiedLevel: ComplexityLevel.AGENT,
  });

  assert(rememberLog.length >= 2, 'expected two remember calls when files created');
  assert(rememberLog.some((v) => v.includes('Delegated to')), 'delegation summary');
  assert(rememberLog.some((v) => v.includes('Files created')), 'files line');
}

async function runTests() {
  console.log('AgentRouter tests\n');
  await testClaudeCodeRoutesToExecute();
  await testDocAgentRoutesToExecute();
  await testVisionAgentRoutesToExecute();
  await testUserPresetRoutesToUserAgentRunner();
  await testUnknownAgentNoThrow();
  await testNotifyRunsBeforeExecute();
  await testMemoryAfterDelegationResult();
  console.log('\nAll AgentRouter tests passed.');
}

runTests()
  .then(() => {
    // AmplifierLoop integration leaves the event loop active (e.g. pending handles); force exit for test runner.
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
