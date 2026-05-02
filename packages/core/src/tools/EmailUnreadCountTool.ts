import type { EmailService } from '../email/EmailService.js';
import { ExecutableTool, ToolResult } from './types.js';

function providerLabel(provider: string): string {
  if (provider === 'google') return 'Gmail';
  if (provider === 'microsoft') return 'Outlook / Microsoft';
  return 'IMAP';
}

export class EmailUnreadCountTool implements ExecutableTool {
  name = 'email_unread_count';
  description =
    'Report how many UNREAD emails are in each connected mailbox INBOX (Gmail labels, Outlook/Graph inbox, IMAP UNSEEN). Use when the user asks for unread counts, bandeja sin leer, or similar — do not tell them to open the mail website manually.';
  parameters = {
    type: 'object' as const,
    properties: {
      accountId: {
        type: 'string',
        description: 'Optional: one account id; omit to include every configured mailbox',
      },
    },
    required: [],
  };

  constructor(private readonly emailService: EmailService) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      if (this.emailService.getConfiguredAccounts().length === 0) {
        return {
          success: true,
          output:
            'No hay cuentas con correo configurado para leer (IMAP + contraseña o Gmail/Microsoft con OAuth en la página Correo).',
        };
      }

      const accountId = typeof input.accountId === 'string' ? input.accountId.trim() : '';
      const r = await this.emailService.getUnreadInboxCounts(accountId || undefined);

      if (!r.success || !r.rows) {
        return { success: false, output: '', error: r.error ?? 'Unread count failed' };
      }

      const lines: string[] = ['📬 Correos sin leer (INBOX)', ''];
      for (const row of r.rows) {
        lines.push(
          `- ${row.label} (${providerLabel(row.provider)}, id «${row.accountId}»): ${row.unread} sin leer`
        );
      }
      lines.push('', 'Los totales son de la carpeta Bandeja de entrada / INBOX definida por cada proveedor.');
      return { success: true, output: lines.join('\n') };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: msg };
    }
  }
}
