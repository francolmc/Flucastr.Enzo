import type { Step, StepAction } from '../types.js';
import type { Subtask } from '../Decomposer.js';

/** Planned subtask implies a concrete tool invocation (excluding `none`). */
export function subtaskRequiresExecutablePlanTool(subtask: Subtask): boolean {
  const t = (subtask.tool ?? '').trim();
  return t.length > 0 && t !== 'none';
}

/** Heuristic failure patterns on ACT output (status alone can be flaky for substring 'error'). */
export function toolActOutputIndicatesFailure(output: string | undefined): boolean {
  const o = (output ?? '').toLowerCase();
  if (o.includes('error [tool_validation')) return true;
  if (o.includes('error [tool_execution')) return true;
  if (o.includes('error [tool_')) return true;
  if (o.includes('tool not found')) return true;
  if (o.includes('skill not found')) return true;
  if (o.includes('skill registry not available')) return true;
  if (o.startsWith('error:')) return true;
  return false;
}

export function actStepInvokedAllowedToolSucceeded(step: Step, plannedTool: string): boolean {
  if (step.type !== 'act' || step.status === 'error') return false;

  const action = step.action as StepAction | undefined;
  if (action !== 'tool' && action !== 'mcp') return false;
  if (step.target !== plannedTool) return false;
  return !toolActOutputIndicatesFailure(step.output);
}

/** Successful delegation substitutes for invoking the planner's tool name when the model delegated the subtask. */
function actDelegationSucceeded(step: Step): boolean {
  if (step.type !== 'act' || step.action !== 'delegate') return false;
  return step.status !== 'error';
}

/**
 * Whether steps produced since a subtask started include a successful execution matching the plan or delegation.
 */
export function plannedToolSuccessfulInSteps(plannedTool: string, slice: Step[]): boolean {
  for (const s of slice) {
    if (actStepInvokedAllowedToolSucceeded(s, plannedTool)) return true;
    if (actDelegationSucceeded(s)) return true;
  }
  return false;
}

export type ActStepAudit = {
  iteration?: number;
  action?: string;
  target?: string;
  status?: string;
};

export function summarizeActSteps(steps: Step[]): ActStepAudit[] {
  return steps
    .filter((s) => s.type === 'act')
    .map((s) => ({
      iteration: s.iteration,
      action: s.action,
      target: s.target,
      status: s.status,
    }));
}
