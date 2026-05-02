import type { EmailService } from '../email/EmailService.js';
import { ExecutableTool, ToolResult } from './types.js';

export interface ModifyEmailToolInput {
  accountId?: string;
  message_id: string;
  mark_read?: boolean;
  archive?: boolean;
}

export class ModifyEmailTool implements ExecutableTool {
  name = 'modify_email';
  description =
    'Mark Gmail/Outlook messages read and/or archive them. Use message ids from read_email or search_email output for that same account.';
  parameters = {
    type: 'object' as const,
    properties: {
      accountId: {
        type: 'string',
        description: 'When several OAuth accounts exist',
      },
      message_id: {
        type: 'string',
        description: 'Opaque provider message id from read/search email',
      },
      mark_read: { type: 'boolean', description: 'Remove unread state' },
      archive: {
        type: 'boolean',
        description: 'Move out of inbox (Gmail removes INBOX; Outlook moves to archive)',
      },
    },
    required: ['message_id'],
  };

  constructor(private readonly emailService: EmailService) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      if (!this.emailService.hasMutationCapableAccount()) {
        return {
          success: false,
          output: '',
          error: 'OAuth Gmail/Microsoft requerido. Conectá una cuenta desde Correo.',
        };
      }

      const typed = input as unknown as ModifyEmailToolInput;
      const mid = typeof typed.message_id === 'string' ? typed.message_id.trim() : '';
      const markRead = typed.mark_read === true;
      const archive = typed.archive === true;

      const result = await this.emailService.modifyMail({
        accountId: typeof typed.accountId === 'string' ? typed.accountId.trim() : undefined,
        messageId: mid,
        markRead,
        archive,
      });

      if (!result.success) {
        return { success: false, output: '', error: result.error || 'modify_email failed' };
      }

      const parts: string[] = [];
      if (markRead) parts.push('marcado como leído');
      if (archive) parts.push('archivado');
      return { success: true, output: parts.length ? `Listo (${parts.join(', ')}).` : 'Sin cambios.' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: msg };
    }
  }
}
