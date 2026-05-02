import type { NotificationGateway } from '../echo/NotificationGateway.js';
import type { AgentConfig } from '../orchestrator/types.js';
import { isAnthropicDelegationAuthErrorMessage } from './anthropicDelegationUtils.js';
import type { ClaudeCodeAgent } from './ClaudeCodeAgent.js';
import type { DocAgent } from './DocAgent.js';
import type { VisionAgent } from './VisionAgent.js';
import type { UserAgentRunner } from './UserAgentRunner.js';

export interface DelegationRequest {
  agent: string;
  task: string;
  reason: string;
  context: {
    userId: string;
    memories: Array<{ key: string; value: string }>;
    conversationSummary: string;
    previousStepResults?: string;
    imageBase64?: string;
    imageMimeType?: string;
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
  vision_agent: 'análisis de imágenes',
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
  visionAgent: VisionAgent;
  notificationGateway?: Pick<NotificationGateway, 'notify'>;
  /** Resolve DB-backed user preset by id for {@link UserAgentRunner} delegation. */
  resolveUserAgent?: (id: string) => Promise<AgentConfig | undefined>;
  userAgentRunner?: UserAgentRunner;
  /**
   * When {@link VisionAgent} fails with Anthropic auth, try these Anthropic presets in order (same resolution as classifier catalog).
   */
  listAnthropicAgentsForVisionFallback?: (userId: string) => Promise<AgentConfig[]>;
};

export class AgentRouter implements AgentRouterContract {
  private readonly notificationGateway?: Pick<NotificationGateway, 'notify'>;
  private readonly claudeCodeAgent: ClaudeCodeAgent;
  private readonly docAgent: DocAgent;
  private readonly visionAgent: VisionAgent;
  private readonly resolveUserAgent?: (id: string) => Promise<AgentConfig | undefined>;
  private readonly userAgentRunner?: UserAgentRunner;
  private readonly listAnthropicAgentsForVisionFallback?: (userId: string) => Promise<AgentConfig[]>;

  constructor(options: AgentRouterOptions) {
    this.notificationGateway = options.notificationGateway;
    this.claudeCodeAgent = options.claudeCodeAgent;
    this.docAgent = options.docAgent;
    this.visionAgent = options.visionAgent;
    this.resolveUserAgent = options.resolveUserAgent;
    this.userAgentRunner = options.userAgentRunner;
    this.listAnthropicAgentsForVisionFallback = options.listAnthropicAgentsForVisionFallback;
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
      case 'vision_agent':
        await this.notifyIfConfigured(request.context.userId, displayName);
        return this.runVisionAgent(request);
      default: {
        if (this.resolveUserAgent && this.userAgentRunner) {
          const preset = await this.resolveUserAgent(request.agent);
          if (preset) {
            await this.notifyIfConfigured(request.context.userId, preset.name);
            return this.userAgentRunner.execute(request, preset);
          }
        }
        return {
          success: false,
          agent: request.agent,
          output: '',
          error: `Unknown agent: ${request.agent}`,
        };
      }
    }
  }

  private async runVisionAgent(request: DelegationRequest): Promise<DelegationResult> {
    const primary = await this.visionAgent.execute(request);
    if (primary.success) return primary;

    const err = primary.error ?? '';
    const fallback =
      this.listAnthropicAgentsForVisionFallback && this.userAgentRunner
        ? await this.listAnthropicAgentsForVisionFallback(request.context.userId)
        : [];
    const shouldTryAnthropicPreset =
      isAnthropicDelegationAuthErrorMessage(err) && fallback.length > 0 && this.userAgentRunner;

    if (!shouldTryAnthropicPreset) return primary;

    let last = primary;
    for (const preset of fallback) {
      if ((preset.provider || '').toLowerCase() !== 'anthropic' || !(preset.model || '').trim()) continue;
      const r = await this.userAgentRunner.execute(request, preset);
      if (r.success) return r;
      last = r;
      if (!isAnthropicDelegationAuthErrorMessage(r.error ?? '')) break;
    }
    return last;
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
