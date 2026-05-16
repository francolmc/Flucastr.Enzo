import type { Step } from '../types.js';

export function runObservePhase(
  actStep: Step,
  iteration: number,
  requestId: string | undefined,
  modelUsed: string
): Step {
  const toolName = actStep.action === 'tool' && actStep.target ? actStep.target : 'unknown';
  return {
    iteration,
    type: 'observe',
    requestId,
    output: `[TOOL_RESULT | tool=${toolName} | timestamp=${Date.now()} | STALE=on_next_same_request]\n${actStep.output}\n[/TOOL_RESULT]`,
    status: actStep.status ?? 'ok',
    modelUsed,
  };
}
