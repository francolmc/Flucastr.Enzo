import { readFile } from 'fs/promises';
import path from 'path';
import type { MarkItDownService } from '../files/MarkItDownService.js';
import { ExecutableTool, ToolResult } from './types.js';

export class ReadFileTool implements ExecutableTool {
  name = 'read_file';
  description =
    'Read the contents of a file and return them as text. For binary files (PDF, Word, Excel), content is converted to markdown automatically if MarkItDown is available.';
  parameters = {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'Absolute path to the file to read' },
    },
    required: ['path'],
  };

  constructor(private readonly markItDown?: MarkItDownService) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = String(input.path ?? '');
    const ext = path.extname(filePath).toLowerCase();
    const binaryExtensions = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt'];
    try {
      if (binaryExtensions.includes(ext) && this.markItDown) {
        const conversion = await this.markItDown.convert(filePath);
        if (conversion.success && conversion.markdown !== undefined) {
          return { success: true, output: conversion.markdown };
        }
      }

      const content = await readFile(filePath, 'utf8');
      return { success: true, output: content };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: `Cannot read file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
