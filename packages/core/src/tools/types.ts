import { Tool } from '../providers/types.js';

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface ExecutableTool extends Tool {
  execute(input: any): Promise<ToolResult>;
}
