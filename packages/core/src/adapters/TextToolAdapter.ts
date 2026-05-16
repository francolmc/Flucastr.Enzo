import type { ToolCallAdapter } from './ToolCallAdapter.js';
import type { ExecutableTool } from '../tools/types.js';
import { CapabilityResolver } from '../orchestrator/CapabilityResolver.js';
import type { AvailableCapabilities } from '../orchestrator/types.js';

export class TextToolAdapter implements ToolCallAdapter {
  buildToolInstructions(tools: ExecutableTool[]): string {
    return tools
      .map((t) => `- ${t.name}: ${JSON.stringify(t.parameters ?? {})}`)
      .join('\n');
  }

  async parseToolCall(
    response: string,
    availableTools?: ExecutableTool[]
  ): Promise<{ toolName: string; input: Record<string, unknown> } | null> {
    if (!availableTools?.length) return null;
    const resolver = new CapabilityResolver();
    const resolved = await resolver.resolve(response, {
      tools: availableTools,
      skills: [],
      agents: [],
    });
    if (resolved.type !== 'tool') return null;
    return { toolName: resolved.target, input: resolved.input as Record<string, unknown> };
  }

  formatToolResult(toolName: string, result: string): string {
    return `[TOOL_RESULT | tool=${toolName} | STALE=on_next_same_request]\n${result}\n[/TOOL_RESULT]`;
  }
}