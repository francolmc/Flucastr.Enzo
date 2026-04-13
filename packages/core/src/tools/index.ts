export { ToolRegistry } from './ToolRegistry.js';
export type { ExecutableTool, ToolResult } from './types.js';
export { WebSearchTool } from './WebSearchTool.js';
export { ExecuteCommandTool } from './ExecuteCommandTool.js';
export { ReadFileTool } from './ReadFileTool.js';
export { RememberTool } from './RememberTool.js';
export { WriteFileTool } from './WriteFileTool.js';

import { MemoryService } from '../memory/MemoryService.js';
import { ConfigService } from '../config/ConfigService.js';
import { ToolRegistry } from './ToolRegistry.js';
import { WebSearchTool } from './WebSearchTool.js';
import { ExecuteCommandTool } from './ExecuteCommandTool.js';
import { ReadFileTool } from './ReadFileTool.js';
import { RememberTool } from './RememberTool.js';
import { WriteFileTool } from './WriteFileTool.js';

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
