import type { MemoryService, ConfigService } from '@enzo/core';
import {
  ToolRegistry,
  WebSearchTool,
  ExecuteCommandTool,
  ReadFileTool,
  RememberTool,
  WriteFileTool,
  resolveWorkspaceRoot,
} from '@enzo/core';

/**
 * Default tool set for API / Telegram: Tavily-backed search, shell, filesystem, memory.
 * Tavily key comes from `ConfigService` (encrypted system secret) or `TAVILY_API_KEY`.
 *
 * @param workspacePath - Root for `read_file` when paths are relative. If omitted, `ReadFileTool` uses
 *   `process.env.ENZO_WORKSPACE_PATH` or falls back to `./workspace` (see `ReadFileTool` in `@enzo/core`).
 */
export function createDefaultToolRegistry(
  memoryService: MemoryService,
  workspacePath?: string,
  configService?: ConfigService
): ToolRegistry {
  const registry = new ToolRegistry();
  const resolvedWorkspace = resolveWorkspaceRoot(workspacePath);
  registry.register(new WebSearchTool(() => configService?.getSystemSecret('tavilyApiKeyEncrypted') ?? null));
  registry.register(new ExecuteCommandTool({ cwd: resolvedWorkspace }));
  registry.register(new ReadFileTool(workspacePath));
  registry.register(new RememberTool(memoryService));
  registry.register(new WriteFileTool(workspacePath));
  return registry;
}
