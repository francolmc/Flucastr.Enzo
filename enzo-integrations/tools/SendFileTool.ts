import { basename, resolve, isAbsolute } from 'path';
import { ExecutableTool, ToolResult } from './types.js';
import type { FileHandler } from '../files/FileHandler.js';

export type SendFileFn = (chatId: string, buffer: Buffer, filename: string) => Promise<void>;

export class SendFileTool implements ExecutableTool {
  name = 'send_file';
  description = 'Send a file to the user via Telegram';

  parameters = {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'Absolute path of the file to send' },
    },
    required: ['path'],
  };

  constructor(
    private readonly sendFileFn: SendFileFn,
    private readonly fileHandler: FileHandler,
    private readonly telegramChatId: string
  ) {
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const pathRaw = String(input.path ?? '').trim();
    try {
      const fullPath = isAbsolute(pathRaw) ? resolve(pathRaw) : resolve(process.cwd(), pathRaw);
      const exists = await this.fileHandler.exists(fullPath);
      if (!exists) {
        return { success: false, output: '', error: `File not found: ${pathRaw}` };
      }

      const buffer = await this.fileHandler.read(fullPath);
      const name = basename(fullPath);
      await this.sendFileFn(this.telegramChatId, buffer, name);
      return { success: true, output: `File sent: ${name}` };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
