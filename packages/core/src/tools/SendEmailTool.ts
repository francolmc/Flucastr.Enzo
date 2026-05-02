import type { EmailService } from '../email/EmailService.js';
import { ExecutableTool, ToolResult } from './types.js';

export interface SendEmailToolInput {
  accountId?: string;
  to: string[];
  cc?: string[];
  subject: string;
  body_text?: string;
  body_html?: string;
}

export class SendEmailTool implements ExecutableTool {
  name = 'send_email';
  description =
    'Send an email via a connected Gmail or Microsoft OAuth account. Does not apply to plain IMAP accounts.';
  parameters = {
    type: 'object' as const,
    properties: {
      accountId: {
        type: 'string',
        description: 'Account id when several OAuth mailboxes exist; omit if only one',
      },
      to: {
        type: 'array',
        items: { type: 'string' },
        description: 'Recipient addresses',
      },
      cc: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional CC addresses',
      },
      subject: { type: 'string', description: 'Email subject line' },
      body_text: { type: 'string', description: 'Plain text body' },
      body_html: {
        type: 'string',
        description: 'Optional HTML body (if set, prefer over body_text)',
      },
    },
    required: ['to', 'subject'],
  };

  constructor(private readonly emailService: EmailService) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      if (!this.emailService.hasMutationCapableAccount()) {
        return {
          success: false,
          output: '',
          error:
            'No hay cuenta Gmail/Microsoft con OAuth conectada. Conectá una cuenta OAuth desde la UI de Correo.',
        };
      }

      const typed = input as unknown as SendEmailToolInput;
      const subject = typeof typed.subject === 'string' ? typed.subject : '';
      const to = Array.isArray(typed.to) ? typed.to.filter((x) => typeof x === 'string') : [];

      const result = await this.emailService.sendMail({
        accountId: typeof typed.accountId === 'string' ? typed.accountId.trim() : undefined,
        to,
        cc: Array.isArray(typed.cc) ? typed.cc.filter((x) => typeof x === 'string') : undefined,
        subject,
        bodyText: typeof typed.body_text === 'string' ? typed.body_text : undefined,
        bodyHtml: typeof typed.body_html === 'string' ? typed.body_html : undefined,
      });

      if (!result.success) {
        return { success: false, output: '', error: result.error || 'send_email failed' };
      }

      const idLine = result.messageId ? ` Id: ${result.messageId}.` : '';
      return { success: true, output: `Correo enviado.${idLine}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: msg };
    }
  }
}
