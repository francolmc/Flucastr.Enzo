import type { EmailMessage } from '../email/IMAPClient.js';
import type { EmailService } from '../email/EmailService.js';
import { ExecutableTool, ToolResult } from './types.js';

export interface SearchEmailInput {
  query: string;
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

function formatSearchOutput(messages: EmailMessage[], requestedLimit: number, locale: string): string {
  const lines: string[] = [`📧 Resultados de búsqueda`, ``];
  const shown = messages.slice(0, requestedLimit);
  shown.forEach((msg, i) => {
    const prev = msg.preview.replace(/\s+/g, ' ').trim();
    lines.push(
      `${i + 1}. ${msg.accountLabel ? `[${msg.accountLabel}] ` : ''}De: ${msg.from} | ${msg.subject}`,
      `   Fecha: ${formatBriefDate(msg.date instanceof Date ? msg.date : new Date(msg.date), locale)} — ${prev.slice(0, 200)}…`,
      ``
    );
  });
  const rest = messages.length - shown.length;
  if (rest > 0) {
    lines.push(`(${rest} más no mostrados)`);
  }
  return lines.join('\n').trim();
}

export class SearchEmailTool implements ExecutableTool {
  name = 'search_email';
  description = 'Search emails by sender, subject or content';
  parameters = {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Text to find' },
      accountId: { type: 'string', description: 'Optional account id' },
      limit: { type: 'number', description: 'Maximum number of messages' },
      since: { type: 'string', description: 'Optional since date in ISO format' },
      folder: { type: 'string', description: 'Optional IMAP folder' },
    },
    required: ['query'],
  };

  constructor(private readonly emailService: EmailService) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      if (this.emailService.getConfiguredAccounts().length === 0) {
        return { success: true, output: 'No hay cuentas de email configuradas.' };
      }

      const typed = input as unknown as SearchEmailInput;
      const q = typeof typed.query === 'string' ? typed.query.trim() : '';
      if (!q) {
        return { success: false, output: '', error: 'query is required' };
      }

      const limit = Math.max(1, Math.min(50, typed.limit ?? 10));
      const since = typed.since ? new Date(typed.since) : undefined;
      const accountId = typeof typed.accountId === 'string' ? typed.accountId.trim() : undefined;
      const folder = typeof typed.folder === 'string' ? typed.folder.trim() : undefined;

      const result = await this.emailService.search({
        query: q,
        accountId: accountId || undefined,
        limit: limit + 5,
        since,
        folder,
      });

      if (!result.success) {
        return { success: false, output: '', error: result.error || 'Search failed' };
      }

      const messages = result.messages ?? [];
      const locale = 'es-AR';
      const formatted = formatSearchOutput(messages, limit, locale);

      return { success: true, output: formatted };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: msg };
    }
  }
}
