import { ExecutableTool, ToolExecutionContext, ToolResult } from './types.js';
import { MemoryService } from '../memory/MemoryService.js';

export class RememberTool implements ExecutableTool {
  name = 'remember';
  readonly actionAliases = ['recordar', 'guardar_memoria'] as const;
  description = 'Save information to memory explicitly';
  parameters = {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Memory key' },
      value: { type: 'string', description: 'Content to remember' },
      userId: { type: 'string', description: 'User ID' },
    },
    required: ['key', 'value', 'userId'],
  };

  private memoryService: MemoryService;

  constructor(memoryService: MemoryService) {
    this.memoryService = memoryService;
  }

  injectExecutionContext(input: Record<string, unknown>, ctx: ToolExecutionContext): void {
    const uid = ctx.userId;
    if (!uid || typeof uid !== 'string') return;
    const existing = input['userId'];
    if (existing === undefined || existing === null || String(existing).trim() === '') {
      input['userId'] = uid;
    }
  }

  async execute(input: any): Promise<ToolResult> {
    try {
      const { key, value, userId } = input;

      console.log(`[RememberTool] execute() called with:`, { key, value, userId, inputKeys: Object.keys(input) });

      if (!key || typeof key !== 'string') {
        return {
          success: false,
          error: 'Key must be a non-empty string',
        };
      }

      if (!value || typeof value !== 'string') {
        return {
          success: false,
          error: 'Value must be a non-empty string',
        };
      }

      if (!userId || typeof userId !== 'string') {
        console.error(`[RememberTool] Invalid userId:`, userId);
        return {
          success: false,
          error: 'UserId must be a non-empty string',
        };
      }

      console.log(`[RememberTool] Saving memory for userId ${userId}: ${key} = ${value}`);
      await this.memoryService.remember(userId, key, value);
      console.log(`[RememberTool] Memory saved successfully`);

      return {
        success: true,
        data: `Successfully saved memory: ${key} = ${value}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
