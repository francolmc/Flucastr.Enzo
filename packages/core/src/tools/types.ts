import { Tool } from '../providers/types.js';

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

/** Passed into optional tool hooks (inject / format). */
export interface ToolExecutionContext {
  userId?: string;
  requestId?: string;
  /** Used by tools that support multiple presentation modes (e.g. web search). */
  outputStyle?: 'full' | 'compact';
  /** Set when the request comes from the Telegram bot. */
  telegramChatId?: string;
  /** Web conversation id; optional target for in-app / future push delivery. */
  conversationId?: string;
  /** User/session timezone hint (e.g. America/Santiago). */
  timeZone?: string;
  source?: 'web' | 'telegram' | 'unknown';
}

export interface ExecutableTool extends Tool {
  execute(input: any, context?: ToolExecutionContext): Promise<ToolResult>;
  /**
   * Lowercase values of the JSON `action` field that imply this tool (fast-path i18n).
   * Example: `ejecutar_comando` → `execute_command`.
   */
  actionAliases?: readonly string[];
  /**
   * Trigger phrases (case-insensitive, diacritic-insensitive) on the user's raw message that
   * should route directly to this tool, bypassing the LLM tool selection step.
   */
  triggers?: readonly string[];
  /** Mutates `input` before validation and `execute` (e.g. inject `userId` for remember). */
  injectExecutionContext?(input: Record<string, unknown>, ctx: ToolExecutionContext): void;
  /** When set, successful act-phase output uses this instead of `JSON.stringify(data)`. */
  formatToolOutput?(data: unknown, ctx: ToolExecutionContext): string | undefined;
}
