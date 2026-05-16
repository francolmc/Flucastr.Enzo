import type { ExecutableTool } from '../tools/types.js';

export interface ToolCallAdapter {
  buildToolInstructions(tools: ExecutableTool[]): string;
  parseToolCall(
    response: string,
    availableTools?: ExecutableTool[]
  ): Promise<{ toolName: string; input: Record<string, unknown> } | null>;
  formatToolResult(toolName: string, result: string): string;
}