import type { MemoryService, ConfigService, SendFileFn, FileHandler } from '@enzo/core';
import {
  ToolRegistry,
  WebSearchTool,
  ExecuteCommandTool,
  ReadFileTool,
  RememberTool,
  RecallTool,
  WriteFileTool,
  SendFileTool,
  resolveWorkspaceRoot,
  MarkItDownConverter,
  EmailService,
  ReadEmailTool,
  SearchEmailTool,
} from '@enzo/core';

export interface TelegramFileDeliveryDeps {
  fileHandler: FileHandler;
  sendFileFn: SendFileFn;
}

/**
 * Default tool set for API / Telegram: Tavily-backed search, shell, filesystem, memory.
 * Tavily key comes from `ConfigService` (encrypted system secret) or `TAVILY_API_KEY`.
 *
 * @param workspacePath - Root for `read_file` when paths are relative. If omitted, `ReadFileTool` uses
 *   `process.env.ENZO_WORKSPACE_PATH` or falls back to `./workspace` (see `ReadFileTool` in `@enzo/core`).
 * @param telegramFileDelivery - When set (typically Telegram bot), registers `send_file`.
 */
export function createDefaultToolRegistry(
  memoryService: MemoryService,
  workspacePath?: string,
  configService?: ConfigService,
  telegramFileDelivery?: TelegramFileDeliveryDeps
): ToolRegistry {
  const registry = new ToolRegistry();
  const resolvedWorkspace = resolveWorkspaceRoot(workspacePath);
  const markItDownService = new MarkItDownConverter();
  registry.register(new WebSearchTool(() => configService?.getSystemSecret('tavilyApiKeyEncrypted') ?? null));
  registry.register(new ExecuteCommandTool({ cwd: resolvedWorkspace }));
  registry.register(new ReadFileTool(workspacePath, { markItDownService }));
  registry.register(new RememberTool(memoryService));
  registry.register(new RecallTool(memoryService));
  registry.register(new WriteFileTool(workspacePath));
  if (telegramFileDelivery) {
    registry.register(
      new SendFileTool(telegramFileDelivery.sendFileFn, telegramFileDelivery.fileHandler, workspacePath)
    );
  }
  const emailService = configService ? new EmailService(configService) : undefined;
  if (emailService && emailService.getConfiguredAccounts().length > 0) {
    registry.register(new ReadEmailTool(emailService));
    registry.register(new SearchEmailTool(emailService));
  }
  return registry;
}
