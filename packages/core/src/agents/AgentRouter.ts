import type { NotificationGateway } from '../echo/NotificationGateway.js';
import type { ClaudeCodeAgent } from './ClaudeCodeAgent.js';
import type { DocAgent } from './DocAgent.js';

export interface DelegationRequest {
  agent: string;
  task: string;
  reason: string;
  context: {
    userId: string;
    memories: Array<{ key: string; value: string }>;
    conversationSummary: string;
    previousStepResults?: string;
  };
}

export interface DelegationResult {
  success: boolean;
  agent: string;
  output: string;
  filesCreated?: string[];
  error?: string;
}

export const DELEGATION_NOT_CONFIGURED =
  'Delegation is not configured (no agent router). Ask an operator to enable AgentRouter.';

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  claude_code: 'asistente de código',
  doc_agent: 'generador de documentos',
};

/**
 * Contrato inyectable en `AmplifierLoopOptions.agentRouter` (instancia de {@link AgentRouter} o mock con `delegate`).
 */
export type AgentRouterContract = {
  delegate(request: DelegationRequest): Promise<DelegationResult>;
};

export type AgentRouterOptions = {
  claudeCodeAgent: ClaudeCodeAgent;
  docAgent: DocAgent;
  notificationGateway?: Pick<NotificationGateway, 'notify'>;
};

export class AgentRouter implements AgentRouterContract {
  private readonly notificationGateway?: Pick<NotificationGateway, 'notify'>;
  private readonly claudeCodeAgent: ClaudeCodeAgent;
  private readonly docAgent: DocAgent;

  constructor(options: AgentRouterOptions) {
    this.notificationGateway = options.notificationGateway;
    this.claudeCodeAgent = options.claudeCodeAgent;
    this.docAgent = options.docAgent;
  }

  async delegate(request: DelegationRequest): Promise<DelegationResult> {
    const displayName = AGENT_DISPLAY_NAMES[request.agent] ?? request.agent;
    switch (request.agent) {
      case 'claude_code':
        await this.notifyIfConfigured(request.context.userId, displayName);
        return this.claudeCodeAgent.execute(request);
      case 'doc_agent':
        await this.notifyIfConfigured(request.context.userId, displayName);
        return this.docAgent.execute(request);
      default:
        return {
          success: false,
          agent: request.agent,
          output: '',
          error: `Unknown agent: ${request.agent}`,
        };
    }
  }

  private async notifyIfConfigured(userId: string, displayName: string): Promise<void> {
    if (!this.notificationGateway) {
      return;
    }
    await this.notificationGateway.notify(
      userId,
      `⚙️ Esto requiere un agente especializado (${displayName}). Lo resuelvo y te cuento.`,
      { priority: 'NORMAL' }
    );
  }
}
