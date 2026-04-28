import { ExecutableTool, ToolResult } from './types.js';
import { MemoryService } from '../memory/MemoryService.js';
import { normalizeMemoryKey } from '../memory/MemoryKeys.js';

export class RememberTool implements ExecutableTool {
  name = 'remember';
  description = 'Save a fact about the user to persistent memory';
  parameters = {
    type: 'object' as const,
    properties: {
      key: {
        type: 'string',
        description:
          'Category: name, city, profession, projects, preferences, routines, family, or other',
      },
      value: {
        type: 'string',
        description: 'The information to remember',
      },
    },
    required: ['key', 'value'],
  };

  constructor(
    private readonly memoryService: MemoryService,
    private readonly userId: string
  ) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const key = normalizeMemoryKey(String(input.key ?? ''));
    const value = String(input.value ?? '');
    try {
      await this.memoryService.remember(this.userId, key, value);
      return { success: true, output: `Remembered: ${key} = ${value}` };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
