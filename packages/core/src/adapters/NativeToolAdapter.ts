import type { ToolCallAdapter } from './ToolCallAdapter.js';
import type { ExecutableTool } from '../tools/types.js';

export class NativeToolAdapter implements ToolCallAdapter {
  buildToolInstructions(_tools: ExecutableTool[]): string {
    return '';
  }

  async parseToolCall(
    response: string,
    _availableTools?: ExecutableTool[]
  ): Promise<{ toolName: string; input: Record<string, unknown> } | null> {
    try {
      const parsed = JSON.parse(response);
      if (parsed.type === 'tool_use') {
        return { toolName: parsed.name, input: parsed.input ?? {} };
      }
    } catch {}
    return null;
  }

  formatToolResult(toolName: string, result: string): string {
    return `[TOOL_RESULT | tool=${toolName}]\n${result}\n[/TOOL_RESULT]`;
  }
}