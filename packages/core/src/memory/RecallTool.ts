import { ExecutableTool, ToolResult } from '../tools/types.js';
import { MemoryService } from './MemoryService.js';
import { rankMemoriesByLexicalSimilarity, parseMemoryRecallTopK } from './MemoryRecallRank.js';

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
    const query = String(input.query ?? '').trim();
    try {
      const memories = await this.memoryService.recall(this.userId);
      if (!memories.length) {
        return { success: true, output: 'No stored memories for this user.' };
      }
      const topK = parseMemoryRecallTopK();
      const qLower = query.toLowerCase();
      let matches =
        query.length === 0
          ? memories
          : memories.filter(
              (memory: { key: string; value: string }) =>
                memory.key.toLowerCase().includes(qLower) || memory.value.toLowerCase().includes(qLower)
            );
      if (matches.length === 0 && query.length > 0) {
        matches = rankMemoriesByLexicalSimilarity(query, memories, Math.max(topK, 5));
      } else if (topK > 0 && matches.length > topK) {
        matches = rankMemoriesByLexicalSimilarity(query || memories.map((m) => m.key).join(' '), matches, topK);
      }
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
