import { ExecutableTool, ToolResult } from '../tools/types.js';
import { MemoryService } from './MemoryService.js';

export class RecallTool implements ExecutableTool {
  name = 'recall';
  description = 'Search user memory for information. Returns matching stored facts.';
  parameters = {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'What to search for in memory' },
    },
    required: ['query'],
  };

  constructor(
    private readonly memoryService: MemoryService,
    private readonly userId: string
  ) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = String(input.query ?? '').toLowerCase();
    try {
      const memories = await this.memoryService.recall(this.userId);
      const matches = memories.filter(
        (memory: { key: string; value: string }) =>
          memory.key.includes(query) || memory.value.toLowerCase().includes(query)
      );
      if (!matches.length) {
        return { success: true, output: `No memories found for: ${query}` };
      }
      const output = matches.map((memory: { key: string; value: string }) => `${memory.key}: ${memory.value}`).join('\n');
      return { success: true, output };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
