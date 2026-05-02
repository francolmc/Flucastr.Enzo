import type { EmailMessage } from '../email/IMAPClient.js';
import type { EmailService } from '../email/EmailService.js';
import { ExecutableTool, ToolResult } from './types.js';

export interface ReadEmailInput {
  accountId?: string;
  limit?: number;
  since?: string;
  folder?: string;
}

function formatBriefDate(date: Date, locale: string): string {
  const now = new Date();
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cmp = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const y0 = new Date(d0);
  y0.setDate(y0.getDate() - 1);
  const tf = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  if (cmp.getTime() === d0.getTime()) {
    return `hoy ${tf.format(date)}`;
  }
  if (cmp.getTime() === y0.getTime()) {
    return `ayer ${tf.format(date)}`;
  }
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatReadEmailOutput(
  messages: EmailMessage[],
  requestedLimit: number,
  accountLabel: string | undefined,
  locale: string
): string {
  const head = accountLabel ? `Emails recientes (cuenta: ${accountLabel})` : `Emails recientes`;
  const lines: string[] = [`📧 ${head}`, ``];
  const shown = messages.slice(0, requestedLimit);
  shown.forEach((msg, i) => {
    const prev = msg.preview.replace(/\s+/g, ' ').trim();
    lines.push(
      `${i + 1}. De: ${msg.from} | Asunto: ${msg.subject}`,
      `   Fecha: ${formatBriefDate(msg.date instanceof Date ? msg.date : new Date(msg.date), locale)} | Vista previa: "${prev.slice(0, 280)}${prev.length > 280 ? '…' : ''}"`,
      ``
    );
  });
  const rest = messages.length - shown.length;
  if (rest > 0) {
    lines.push(`[${rest} emails más no mostrados. Pedí más si necesitás.]`);
  }
  return lines.join('\n').trim();
}

export class ReadEmailTool implements ExecutableTool {
  name = 'read_email';
  description = 'Read recent emails from configured accounts';
  parameters = {
    type: 'object' as const,
    properties: {
      accountId: { type: 'string', description: 'Specific account id or omit for all' },
      limit: { type: 'number', description: 'Max messages (default 10)' },
      since: { type: 'string', description: 'ISO date or today / yesterday / this week' },
      folder: { type: 'string', description: 'IMAP folder (default INBOX)' },
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
            'No hay cuentas listas para leer correo (IMAP con contraseña o Gmail/Outlook con OAuth). Editá ~/.enzo/config.json y completá desde la página Correo.',
        };
      }

      const typed = input as ReadEmailInput;
      const limit = Math.max(1, Math.min(50, typed.limit ?? 10));
      const since = typed.since ? new Date(typed.since) : undefined;
      const accountId = typeof typed.accountId === 'string' ? typed.accountId.trim() : undefined;
      const folder = typeof typed.folder === 'string' ? typed.folder.trim() : undefined;

      const result = await this.emailService.getRecent({
        accountId: accountId || undefined,
        limit: limit + 5,
        since,
        folder,
      });

      if (!result.success) {
        return {
          success: false,
          output: '',
          error: result.error || 'Failed to load email',
        };
      }

      const messages = result.messages ?? [];
      const accounts = this.emailService.getConfiguredAccounts();
      let label: string | undefined;
      if (accountId) {
        label = accounts.find((a) => a.id === accountId)?.label;
      }

      const formatted = formatReadEmailOutput(messages, limit, label, 'es-AR');

      return {
        success: true,
        output: formatted,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: msg };
    }
  }
}
