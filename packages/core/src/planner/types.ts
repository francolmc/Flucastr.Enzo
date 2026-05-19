export interface ExecutionContext {
  understandContext: string;
  conversationContext: string;
  previousResults: string[];
}

export interface Step {
  text: string;
}

export interface PlannerOptions {
  maxTotalSteps: number;
}

export const DEFAULT_PLANNER_OPTIONS: PlannerOptions = {
  maxTotalSteps: 12,
};

export interface PlannerResponse {
  content: string;
  stepsExecuted: number;
  stepsPlanned: number;
  truncated: boolean;
}

export interface Fact {
  key: string;
  value: string;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}