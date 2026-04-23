import type { MemoryService, ConfigService } from '@enzo/core';
import {
  ToolRegistry,
  WebSearchTool,
  ExecuteCommandTool,
  ReadFileTool,
  RememberTool,
  WriteFileTool,
} from '@enzo/core';

/** Product wiring: Tavily + default tools. Kept out of `@enzo/core` to avoid secret coupling in the library surface. */
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
