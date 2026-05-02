import type { ConfigService, MemoryService, NotificationGateway } from '@enzo/core';
import { AgentRouter, ClaudeCodeAgent, DocAgent, UserAgentRunner, VisionAgent } from '@enzo/core';

/**
 * Wires the delegation router with concrete Anthropic-backed agents. Use the same `workspacePath`
 * as {@link createDefaultToolRegistry} so `write_file` from `<file path="...">` matches tool policy.
 */
export function createAgentRouter(
  configService: ConfigService,
  memoryService: MemoryService,
  notificationGateway: Pick<NotificationGateway, 'notify'>,
  workspacePath?: string
): AgentRouter {
  const userAgentRunner = new UserAgentRunner(configService);
  return new AgentRouter({
    notificationGateway,
    claudeCodeAgent: new ClaudeCodeAgent(configService, workspacePath),
    docAgent: new DocAgent(configService, workspacePath),
    visionAgent: new VisionAgent(configService),
    resolveUserAgent: async (id) => {
      const row = await memoryService.getAgent(id);
      if (!row) return undefined;
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
    },
    userAgentRunner,
  });
}
