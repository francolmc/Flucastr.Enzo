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
  MarkItDownConverter,
  EmailService,
  ReadEmailTool,
  SearchEmailTool,
  SendEmailTool,
  ModifyEmailTool,
  EmailUnreadCountTool,
  CalendarTool,
  CalendarService,
} from '@enzo/core';

export interface TelegramFileDeliveryDeps {
  fileHandler: FileHandler;
  sendFileFn: SendFileFn;
}

/**
 * Default tool set for API / Telegram: Tavily-backed search, shell, filesystem, memory.
 * Tavily key comes from `ConfigService` (encrypted system secret) or `TAVILY_API_KEY`.
 *
 * @param workspacePath - Root for `read_file` and `execute_command` when paths are relative. If omitted,
 *   `ExecuteCommandTool` uses `process.cwd()` and `ReadFileTool` treats all paths as absolute.
 * @param telegramFileDelivery - When set (typically Telegram bot), registers `send_file`.
 */
export function createDefaultToolRegistry(
  memoryService: MemoryService,
  workspacePath?: string,
  configService?: ConfigService,
  telegramFileDelivery?: TelegramFileDeliveryDeps
): ToolRegistry {
  const registry = new ToolRegistry();
  const defaultUserId = process.env.ENZO_DEFAULT_USER_ID ?? 'default-user';
  const markItDownService = new MarkItDownConverter();
  const apiKey = configService?.getSystemSecret('tavilyApiKeyEncrypted') ?? process.env.TAVILY_API_KEY ?? '';
  registry.register(new WebSearchTool(apiKey));
  registry.register(new ExecuteCommandTool(workspacePath ?? process.cwd()));
  registry.register(new ReadFileTool(markItDownService, workspacePath));
  registry.register(new RememberTool(memoryService, defaultUserId));
  registry.register(new RecallTool(memoryService, defaultUserId));
  registry.register(new CalendarTool(new CalendarService(memoryService.getDbPath())));
  registry.register(new WriteFileTool());
  if (telegramFileDelivery) {
    const telegramChatId = process.env.ENZO_DEFAULT_TELEGRAM_CHAT_ID ?? '';
    registry.register(
      new SendFileTool(telegramFileDelivery.sendFileFn, telegramFileDelivery.fileHandler, telegramChatId)
    );
  }
  const emailService = configService ? new EmailService(configService) : undefined;
  if (emailService && emailService.getConfiguredAccounts().length > 0) {
    registry.register(new EmailUnreadCountTool(emailService));
    registry.register(new ReadEmailTool(emailService));
    registry.register(new SearchEmailTool(emailService));
  }
  if (emailService && emailService.hasMutationCapableAccount()) {
    registry.register(new SendEmailTool(emailService));
    registry.register(new ModifyEmailTool(emailService));
  }
  return registry;
}
