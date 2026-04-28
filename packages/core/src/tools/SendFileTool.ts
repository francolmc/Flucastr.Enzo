import { basename, resolve, isAbsolute } from 'path';
import { statSync } from 'fs';
import { ExecutableTool, ToolExecutionContext, ToolResult } from './types.js';
import type { FileHandler } from '../files/FileHandler.js';
import { isPathWithinWorkspace, resolveWorkspaceRoot } from './workspacePathPolicy.js';

const TELEGRAM_MAX_BYTES = 50 * 1024 * 1024;

export type SendFileFn = (chatId: string, buffer: Buffer, filename: string) => Promise<void>;

export class SendFileTool implements ExecutableTool {
  name = 'send_file';
  readonly actionAliases = ['enviar_archivo', 'compartir_archivo', 'mandar_archivo'] as const;
  description = 'Send a file to the user via Telegram';

  parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path or path relative to the workspace root' },
      telegramChatId: { type: 'string', description: 'Telegram chat id (auto-injected for Telegram)' },
    },
    required: ['path', 'telegramChatId'],
  };

  private readonly sendFileFn: SendFileFn;
  private readonly fileHandler: FileHandler;
  private readonly workspaceRoot: string;
  private readonly strictAbsolutePaths: boolean;

  constructor(
    sendFileFn: SendFileFn,
    fileHandler: FileHandler,
    workspacePath?: string,
    options?: { strictAbsolutePaths?: boolean }
  ) {
    this.sendFileFn = sendFileFn;
    this.fileHandler = fileHandler;
    this.workspaceRoot = resolveWorkspaceRoot(workspacePath);
    this.strictAbsolutePaths =
      options?.strictAbsolutePaths ?? process.env.ENZO_STRICT_WORKSPACE === 'true';
  }

  injectExecutionContext(input: Record<string, unknown>, ctx: ToolExecutionContext): void {
    const chatId = ctx.telegramChatId;
    if (!chatId || typeof chatId !== 'string') return;
    const existing = input['telegramChatId'];
    if (existing === undefined || existing === null || String(existing).trim() === '') {
      input['telegramChatId'] = chatId;
    }
  }

  async execute(input: any): Promise<ToolResult> {
    try {
      const pathRaw = input?.path;
      const telegramChatId = input?.telegramChatId;

      if (!pathRaw || typeof pathRaw !== 'string') {
        return { success: false, error: 'Path must be a non-empty string' };
      }

      if (!telegramChatId || typeof telegramChatId !== 'string' || telegramChatId.trim() === '') {
        return {
          success: false,
          error: 'Este comando solo está disponible desde Telegram.',
        };
      }

      let fullPath: string;

      if (isAbsolute(pathRaw)) {
        fullPath = resolve(pathRaw);
        if (this.strictAbsolutePaths && !isPathWithinWorkspace(fullPath, this.workspaceRoot)) {
          return {
            success: false,
            error: `Access denied: absolute path must be inside workspace ${this.workspaceRoot}`,
          };
        }
      } else {
        fullPath = resolve(this.workspaceRoot, pathRaw);
        if (!isPathWithinWorkspace(fullPath, this.workspaceRoot)) {
          return {
            success: false,
            error: `Access denied: path is outside workspace`,
          };
        }
      }

      const exists = await this.fileHandler.exists(fullPath);
      if (!exists) {
        return {
          success: false,
          error: `No encontré el archivo en ${pathRaw}. ¿Podés verificar el nombre o la ubicación?`,
        };
      }

      let sizeBytes = 0;
      try {
        sizeBytes = statSync(fullPath).size;
      } catch {
        return {
          success: false,
          error: `No encontré el archivo en ${pathRaw}. ¿Podés verificar el nombre o la ubicación?`,
        };
      }

      if (sizeBytes > TELEGRAM_MAX_BYTES) {
        return {
          success: false,
          error: 'El archivo es demasiado grande para enviar por Telegram (máximo 50MB).',
        };
      }

      const buffer = await this.fileHandler.read(fullPath);
      const name = basename(fullPath);

      await this.sendFileFn(String(telegramChatId), buffer, name);

      return {
        success: true,
        data: `Archivo ${name} enviado por Telegram ✓`,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        success: false,
        error: msg || 'No se pudo enviar el archivo por Telegram.',
      };
    }
  }
}
