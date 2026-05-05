import type { MemoryService } from '@enzo/core';
import {
  ToolRegistry,
  RememberTool,
  RecallTool,
} from '@enzo/core';

/**
 * Default tool set: memory only (remember + recall).
 * Additional tools (web search, shell, filesystem, email, calendar) should be
 * registered via MCP servers or custom ToolRegistry extensions.
 */
export function createDefaultToolRegistry(
  memoryService: MemoryService,
): ToolRegistry {
  const registry = new ToolRegistry();
  const defaultUserId = process.env.ENZO_DEFAULT_USER_ID ?? 'default-user';
  registry.register(new RememberTool(memoryService, defaultUserId));
  registry.register(new RecallTool(memoryService, defaultUserId));
  return registry;
}
