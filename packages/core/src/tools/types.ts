import { Tool } from '../providers/types.js';

export interface ToolParameterDefinition {
  type: string;
  description: string;
  required?: boolean;
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameterDefinition>;
  required: string[];
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface ExecutableTool extends Tool {
  parameters: ToolParameters;
  execute(input: Record<string, unknown>): Promise<ToolResult>;
}
