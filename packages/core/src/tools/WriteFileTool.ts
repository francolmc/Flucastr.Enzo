import { ExecutableTool, ToolResult } from './types.js';
import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

export class WriteFileTool implements ExecutableTool {
  name = 'write_file';
  description = 'Create or overwrite a file with the given content';
  parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path where the file will be created' },
      content: { type: 'string', description: 'File content to write' },
    },
    required: ['path', 'content'],
  };

  async execute(input: { path: string; content: string }): Promise<ToolResult> {
    try {
      if (!input.path || typeof input.path !== 'string') {
        return { success: false, error: 'path must be a non-empty string' };
      }
      if (typeof input.content !== 'string') {
        return { success: false, error: 'content must be a string' };
      }

      // Crear directorio si no existe
      await mkdir(dirname(input.path), { recursive: true });
      await writeFile(input.path, input.content, 'utf-8');

      console.log(`[WriteFileTool] Written: ${input.path} (${input.content.length} chars)`);
      return {
        success: true,
        data: `File created successfully at ${input.path}`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[WriteFileTool] Error:`, msg);
      return { success: false, error: msg };
    }
  }
}
