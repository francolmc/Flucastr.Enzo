import { Memory } from '../memory/memory.js';

export async function setupTools(memory: Memory): Promise<void> {
  const tools = [
    {
      name: 'read_file',
      description: 'Read the complete contents of a file. Use when you need to see what is already in a file before modifying it.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the file' },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description: 'Create or overwrite a file with new content. Use when you need to save, create, or update any file.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the file' },
          content: { type: 'string', description: 'Full content to write' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'list_directory',
      description: 'List files and directories in a folder.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the directory' },
        },
        required: ['path'],
      },
    },
  ];

  for (const tool of tools) {
    memory.saveTool(tool);
  }
}