import {
  runVerifyBeforeSynthesizeIfEnabled,
  VERIFY_PRESYNTHESIS_MARK,
} from '../amplifier/AmplifierVerifyPhase.js';
import type { CompletionRequest, CompletionResponse, LLMProvider } from '../../providers/types.js';
import type { AmplifierInput, Step } from '../types.js';
import type { Subtask } from '../Decomposer.js';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

class FixedResponseProvider implements LLMProvider {
  name = 'mock';
  model = 'mock-model';
  constructor(private readonly content: string) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async complete(_request: CompletionRequest): Promise<CompletionResponse> {
    return {
      content: this.content,
      usage: { inputTokens: 1, outputTokens: 1 },
      model: this.model,
      provider: this.name,
    };
  }
}

async function testVerifierAppendsStructuredGaps(): Promise<void> {
  const input: AmplifierInput = {
    message: 'do two writes',
    conversationId: 'c1',
    userId: 'u1',
    history: [],
    availableTools: [],
    availableSkills: [],
    availableAgents: [],
    requestId: 'r1',
  };

  const planned: Subtask[] = [
    { id: 1, tool: 'write_file', description: 'a', input: 'x', dependsOn: null },
    { id: 2, tool: 'write_file', description: 'b', input: 'y', dependsOn: 1 },
  ];

  const orchestratorSteps: Step[] = [
    {
      iteration: 1,
      type: 'act',
      requestId: 'r1',
      action: 'tool',
      target: 'write_file',
      status: 'ok',
      output: 'ok',
      durationMs: 1,
      modelUsed: 'm',
    },
  ];

  const provider = new FixedResponseProvider(
    JSON.stringify({
      satisfied: false,
      gaps: 'second write missing',
      missingStepIds: [2],
    })
  );

  const out = await runVerifyBeforeSynthesizeIfEnabled(
    {
      baseProvider: provider,
      withTimeout: <T>(p: Promise<T>) => p,
    },
    input,
    'Some evidence',
    1,
    new Set<string>(),
    true,
    { plannedSubtasks: planned, orchestratorSteps }
  );

  assert(out.step != null && out.step.type === 'verify', 'verify step present');
  assert(out.context.includes(VERIFY_PRESYNTHESIS_MARK), 'marker in context');
  assert(out.context.includes('missing planned step ids per verifier: 2'), 'missing ids surfaced');
  const parsed = JSON.parse(out.step!.output ?? '{}');
  assert(parsed.satisfied === false && Array.isArray(parsed.missingStepIds), 'missingStepIds in verify output');

  console.log('✓ AmplifierVerifyPhase: structured extras → gaps + missingStepIds in context');
}

async function testVerifierSatisfiedSkipsNote(): Promise<void> {
  const input: AmplifierInput = {
    message: 'hello',
    conversationId: 'c1',
    userId: 'u1',
    history: [],
    availableTools: [],
    availableSkills: [],
    availableAgents: [],
  };

  const provider = new FixedResponseProvider(JSON.stringify({ satisfied: true }));

  const out = await runVerifyBeforeSynthesizeIfEnabled(
    { baseProvider: provider, withTimeout: <T>(p: Promise<T>) => p },
    input,
    'evidence',
    1,
    new Set(),
    true,
    {
      plannedSubtasks: [{ id: 1, tool: 'read_file', description: '', input: '', dependsOn: null }],
      orchestratorSteps: [
        {
          iteration: 1,
          type: 'act',
          action: 'tool',
          target: 'read_file',
          status: 'ok',
          output: 'x',
          durationMs: 1,
          modelUsed: 'm',
        },
      ],
    }
  );

  assert(!out.context.includes(VERIFY_PRESYNTHESIS_MARK), 'no gap note when satisfied');
  console.log('✓ AmplifierVerifyPhase: satisfied=true leaves context unchanged');
}

await testVerifierAppendsStructuredGaps();
await testVerifierSatisfiedSkipsNote();
