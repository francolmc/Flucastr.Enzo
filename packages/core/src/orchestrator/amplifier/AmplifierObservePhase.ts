import type { Step } from '../types.js';

export function runObservePhase(
  actStep: Step,
  iteration: number,
  requestId: string | undefined,
  modelUsed: string
): Step {
  return {
    iteration,
    type: 'observe',
    requestId,
    output: actStep.output,
    status: actStep.status ?? 'ok',
    modelUsed,
  };
}
