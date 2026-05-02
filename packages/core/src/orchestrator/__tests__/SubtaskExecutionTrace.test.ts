import {
  plannedToolSuccessfulInSteps,
  subtaskRequiresExecutablePlanTool,
  summarizeActSteps,
} from '../amplifier/SubtaskExecutionTrace.js';
import type { Step } from '../types.js';
import type { Subtask } from '../Decomposer.js';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

const baseActFields = {
  requestId: undefined as string | undefined,
  durationMs: 1,
  modelUsed: 'mock',
};

async function testRequiresTool() {
  assert(
    subtaskRequiresExecutablePlanTool({ id: 1, tool: 'read_file', description: '', input: '', dependsOn: null }),
    'read_file should require tool'
  );
  assert(
    !subtaskRequiresExecutablePlanTool({ id: 1, tool: 'none', description: '', input: '', dependsOn: null }),
    'none should not'
  );
  console.log('✓ SubtaskExecutionTrace: subtaskRequiresExecutablePlanTool');
}

async function testPlanMatchReadFile() {
  const okSlice: Step[] = [
    {
      ...baseActFields,
      iteration: 1,
      type: 'act',
      action: 'tool',
      target: 'read_file',
      output: 'file contents here',
      status: 'ok',
    },
  ];
  assert(plannedToolSuccessfulInSteps('read_file', okSlice), 'matching tool act should succeed');

  const badSlice: Step[] = [
    {
      ...baseActFields,
      iteration: 1,
      type: 'act',
      action: 'tool',
      target: 'read_file',
      output: 'Error [TOOL_EXECUTION_ERROR]: missing file',
      status: 'error',
    },
  ];
  assert(!plannedToolSuccessfulInSteps('read_file', badSlice), 'error act should not count');

  const noneOnly: Step[] = [
    {
      ...baseActFields,
      iteration: 1,
      type: 'think',
      output: 'I will read the file',
      modelUsed: 'mock',
    },
  ];
  assert(!plannedToolSuccessfulInSteps('read_file', noneOnly), 'think-only slice should not satisfy plan');

  console.log('✓ SubtaskExecutionTrace: plannedToolSuccessfulInSteps (read_file)');
}

async function testDelegationCounts() {
  const slice: Step[] = [
    {
      ...baseActFields,
      iteration: 1,
      type: 'act',
      action: 'delegate',
      target: 'claude_code',
      output: 'Delegation request processed',
      status: 'ok',
    },
  ];
  assert(plannedToolSuccessfulInSteps('write_file', slice), 'delegate should satisfy checkpoint');
  console.log('✓ SubtaskExecutionTrace: delegation counts as fulfilled');
}

async function testSummarizeActs() {
  const steps: Step[] = [
    {
      ...baseActFields,
      iteration: 2,
      type: 'act',
      action: 'tool',
      target: 'web_search',
      status: 'ok',
    },
  ];
  const s = summarizeActSteps(steps);
  assert(s.length === 1 && s[0].target === 'web_search', 'summarizeActSteps');
  console.log('✓ SubtaskExecutionTrace: summarizeActSteps');
}

async function testSubtaskTyping() {
  const st: Subtask = { id: 2, tool: 'remember', description: 'x', input: 'y', dependsOn: 1 };
  assert(subtaskRequiresExecutablePlanTool(st), 'remember is actionable');
  console.log('✓ SubtaskExecutionTrace: Subtask typings');
}

async function main() {
  await testRequiresTool();
  await testPlanMatchReadFile();
  await testDelegationCounts();
  await testSummarizeActs();
  await testSubtaskTyping();
}

await main();
