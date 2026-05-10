import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { ExecutableTool, ToolResult } from './types.js';

export class WriteFileTool implements ExecutableTool {
  name = 'write_file';
  description = 'Write content to a file. Creates parent directories if needed. Overwrites if file exists.';
  parameters = {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'Absolute path where the file will be written' },
      content: { type: 'string', description: 'Content to write to the file' },
    },
    required: ['path', 'content'],
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = String(input.path ?? '');
    const content = String(input.content ?? '');
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf8');
      return { success: true, output: `File written: ${filePath}` };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: `Cannot write file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
