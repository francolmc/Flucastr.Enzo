import type { MemoryService, ConfigService } from '@enzo/core';
import {
  ToolRegistry,
  WebSearchTool,
  ExecuteCommandTool,
  ReadFileTool,
  RememberTool,
  WriteFileTool,
} from '@enzo/core';

/** Product wiring: Tavily + default tools. Mirrors `packages/api` — telegram does not depend on `@enzo/api`. */
export function createDefaultToolRegistry(
  memoryService: MemoryService,
  workspacePath?: string,
  configService?: ConfigService
): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new WebSearchTool(() => configService?.getSystemSecret('tavilyApiKeyEncrypted') ?? null));
  registry.register(new ExecuteCommandTool());
  registry.register(new ReadFileTool(workspacePath));
  registry.register(new RememberTool(memoryService));
  registry.register(new WriteFileTool());
  return registry;
}
