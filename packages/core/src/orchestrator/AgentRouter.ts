/**
 * Routes delegated subtasks to specialized agents. Implement in Paso 5.2; inject via {@link AmplifierLoopOptions.agentRouter}.
 */
export interface AgentRouter {
  delegate(agent: string, task: string, context: string): Promise<string>;
}

export const DELEGATION_NOT_CONFIGURED =
  'Delegation is not configured (no agent router). Ask an operator to enable AgentRouter.';
