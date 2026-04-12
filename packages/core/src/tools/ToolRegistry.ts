import { Tool } from '../providers/types.js';
import { ExecutableTool } from './types.js';

export class ToolRegistry {
  private tools: Map<string, ExecutableTool> = new Map();

  register(tool: ExecutableTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ExecutableTool | undefined {
    return this.tools.get(name);
  }

  getAll(): ExecutableTool[] {
    return Array.from(this.tools.values());
  }

  getToolDefinitions(): Tool[] {
    return this.getAll().map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }
}
