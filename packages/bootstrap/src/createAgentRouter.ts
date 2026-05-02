import type {
  AgentConfig,
  AgentRecord,
  ConfigService,
  MemoryService,
  NotificationGateway,
  VisionService,
} from '@enzo/core';
import { AgentRouter, ClaudeCodeAgent, DocAgent, UserAgentRunner, VisionAgent } from '@enzo/core';

function mapAgentRecord(row: AgentRecord): AgentConfig {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    provider: row.provider,
    model: row.model,
    systemPrompt: row.systemPrompt ?? undefined,
    assistantNameOverride: row.assistantNameOverride ?? undefined,
    personaOverride: row.personaOverride ?? undefined,
    toneOverride: row.toneOverride ?? undefined,
  };
}

async function listAgentsForUserFromDb(memoryService: MemoryService, userId: string): Promise<AgentConfig[]> {
  try {
    const byUser = await memoryService.getAgents(userId);
    if (byUser.length > 0) return byUser.map(mapAgentRecord);

    const ownerUserId = process.env.TELEGRAM_AGENT_OWNER_USER_ID?.trim();
    if (ownerUserId && ownerUserId !== userId) {
      const byOwner = await memoryService.getAgents(ownerUserId);
      if (byOwner.length > 0) return byOwner.map(mapAgentRecord);
    }

    const globalAgents = await memoryService.getAllAgents();
    return globalAgents.map(mapAgentRecord);
  } catch (e) {
    console.warn(`[AgentRouter] listAgentsForUserFromDb failed for "${userId}":`, e);
    return [];
  }
}

/**
 * Wires the delegation router with concrete Anthropic-backed agents. Use the same `workspacePath`
 * as {@link createDefaultToolRegistry} so `write_file` from `<file path="...">` matches tool policy.
 */
export type CreateAgentRouterOptions = {
  /** Used when Anthropic vision fails (e.g. invalid API key) so Telegram still gets a pixel-based answer from Ollama. */
  localVisionService?: VisionService;
};

export function createAgentRouter(
  configService: ConfigService,
  memoryService: MemoryService,
  notificationGateway: Pick<NotificationGateway, 'notify'>,
  workspacePath?: string,
  options?: CreateAgentRouterOptions
): AgentRouter {
  const userAgentRunner = new UserAgentRunner(configService);
  return new AgentRouter({
    notificationGateway,
    claudeCodeAgent: new ClaudeCodeAgent(configService, workspacePath),
    docAgent: new DocAgent(configService, workspacePath),
    visionAgent: new VisionAgent(configService, options?.localVisionService),
    resolveUserAgent: async (id) => {
      const row = await memoryService.getAgent(id);
      if (!row) return undefined;
      return mapAgentRecord(row);
    },
    userAgentRunner,
    listAnthropicAgentsForVisionFallback: async (userId) => {
      const agents = await listAgentsForUserFromDb(memoryService, userId);
      return agents.filter(
        (a) =>
          (a.provider || '').toLowerCase() === 'anthropic' && !!(a.model || '').trim()
      );
    },
  });
}
