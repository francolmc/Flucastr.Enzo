import type { ConfigService, MemoryService, NotificationGateway } from '@enzo/core';
import { AgentRouter, ClaudeCodeAgent, DocAgent } from '@enzo/core';

/**
 * Wires the delegation router with concrete Anthropic-backed agents. Use the same `workspacePath`
 * as {@link createDefaultToolRegistry} so `write_file` from `<file path="...">` matches tool policy.
 */
export function createAgentRouter(
  configService: ConfigService,
  _memoryService: MemoryService,
  notificationGateway: Pick<NotificationGateway, 'notify'>,
  workspacePath?: string
): AgentRouter {
  return new AgentRouter({
    notificationGateway,
    claudeCodeAgent: new ClaudeCodeAgent(configService, workspacePath),
    docAgent: new DocAgent(configService, workspacePath),
  });
}
