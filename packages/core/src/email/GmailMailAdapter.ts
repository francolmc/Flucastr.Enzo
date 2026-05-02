import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';

import type { ConfigService } from '../config/ConfigService.js';
import type { EmailMessage } from './IMAPClient.js';
import type { gmail_v1 } from 'googleapis';

function headerVal(
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  needle: string
): string | undefined {
  const n = needle.toLowerCase();
  const h = headers?.find((x) => (x.name || '').toLowerCase() === n);
  const v = h?.value;
  return v && v.trim() ? v.trim() : undefined;
}

function parseFromHeader(fromRaw: string | undefined): string {
  if (!fromRaw) return '(sin remitente)';
  const m = fromRaw.match(/^(.+)<([^>]+)>\s*$/);
  if (m) {
    const name = m[1].trim().replace(/^["']+|["']+$/g, '');
    const addr = m[2].trim();
    return name ? `${name} <${addr}>` : addr;
  }
  return fromRaw.trim();
}

function parseToList(headerRaw: string | undefined): string[] {
  if (!headerRaw) return [];
  return headerRaw
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function gmailFolderToSearchFragment(folder?: string): string {
  const f = (folder || 'INBOX').toUpperCase();
  if (f === 'INBOX') return 'in:inbox';
  if (f === '[GMAIL]/ALL MAIL' || f === 'ALL MAIL') return 'in:all';
  return `in:${folder}`;
}

function sinceQuery(since?: Date): string {
  if (!since || Number.isNaN(since.getTime())) return '';
  const y = since.getFullYear();
  const m = String(since.getMonth() + 1).padStart(2, '0');
  const d = String(since.getDate()).padStart(2, '0');
  return `after:${y}/${m}/${d}`;
}

function payloadHasAttachments(part: gmail_v1.Schema$MessagePart | undefined | null): boolean {
  if (!part) return false;
  const mime = part.mimeType || '';
  if (mime.toLowerCase() === 'multipart/mixed') return true;
  const disposition = ((part.headers || []) as Array<{ name?: string; value?: string }>).find(
    (h) => (h.name || '').toLowerCase() === 'content-disposition'
  )?.value;
  if ((disposition || '').toLowerCase().startsWith('attachment')) return true;
  if (!part.parts?.length) return false;
  return part.parts.some((p) => payloadHasAttachments(p));
}

function buildPlainMime(params: {
  to: string[];
  cc?: string[];
  subject: string;
  bodyText?: string;
}): string {
  const lines: string[] = [];
  lines.push(`To: ${params.to.join(', ')}`);
  if (params.cc?.length) {
    lines.push(`Cc: ${params.cc.join(', ')}`);
  }
  lines.push(`Subject: ${params.subject}`);
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('', params.bodyText ?? '');
  return lines.join('\r\n');
}

/** Gmail API backend for OAuth-backed accounts (`provider: google`). */
export class GmailMailAdapter {
  private oauthCache: OAuth2Client | undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly accountId: string
  ) {}

  private getRefreshToken(): string | null {
    return this.configService.getEmailOAuthRefreshToken(this.accountId);
  }

  private oauthClient(): OAuth2Client {
    if (this.oauthCache) {
      return this.oauthCache;
    }
    const rt = this.getRefreshToken();
    if (!rt) {
      throw new Error(`No Gmail OAuth refresh token for account ${this.accountId}`);
    }
    const { clientId, clientSecret } = this.configService.getGoogleOAuthCredentials();
    if (!clientId) {
      throw new Error('Google OAuth client id not configured (ENZO_GOOGLE_CLIENT_ID)');
    }

    const o = new OAuth2Client(clientId, clientSecret ?? undefined);
    o.setCredentials({ refresh_token: rt });
    this.oauthCache = o;
    return o;
  }

  private gmail() {
    const auth = this.oauthClient();
    return google.gmail({ version: 'v1', auth });
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const gmail = this.gmail();
      await gmail.users.getProfile({ userId: 'me' });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }

  async getRecent(opts: {
    folder?: string;
    limit: number;
    since?: Date;
    labelIdsFallback?: string[];
  }): Promise<EmailMessage[]> {
    const gmail = this.gmail();
    const qParts = [
      gmailFolderToSearchFragment(opts.folder),
      sinceQuery(opts.since),
    ].filter(Boolean);
    const q = qParts.join(' ');

    const list = await gmail.users.messages.list({
      userId: 'me',
      q,
      maxResults: opts.limit,
    });

    const ids = list.data.messages?.map((m) => m.id).filter(Boolean) as string[];
    if (!ids?.length) return [];

    const out: EmailMessage[] = [];
    for (const id of ids.slice(0, opts.limit)) {
      const msg = await this.fetchMessageOverview(gmail, id, opts.folder);
      if (msg) out.push(msg);
    }
    return out;
  }

  async search(opts: {
    query: string;
    folder?: string;
    limit: number;
    since?: Date;
  }): Promise<EmailMessage[]> {
    const gmail = this.gmail();
    const fragments = [`(${opts.query})`, gmailFolderToSearchFragment(opts.folder), sinceQuery(opts.since)].filter(
      Boolean
    );
    const q = fragments.join(' ');

    const list = await gmail.users.messages.list({
      userId: 'me',
      q,
      maxResults: opts.limit,
    });

    const ids = list.data.messages?.map((m) => m.id).filter(Boolean) as string[];
    if (!ids?.length) return [];

    const out: EmailMessage[] = [];
    for (const id of ids.slice(0, opts.limit)) {
      const msg = await this.fetchMessageOverview(gmail, id, opts.folder);
      if (msg) out.push(msg);
    }
    return out;
  }

  private async fetchMessageOverview(gmail: ReturnType<GmailMailAdapter['gmail']>, id: string, folderHint?: string) {
    const r = await gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'metadata',
      metadataHeaders: ['From', 'To', 'Subject', 'Date'],
    });
    const data = r.data;
    const headers = data.payload?.headers as Array<{ name?: string; value?: string }> | undefined;
    const from = parseFromHeader(headerVal(headers, 'From'));
    const to = parseToList(headerVal(headers, 'To'));
    const subject = headerVal(headers, 'Subject') || '(sin asunto)';
    const dateHdr = headerVal(headers, 'Date');
    let date = new Date(Number(data.internalDate) || Date.now());
    if (dateHdr) {
      const parsed = new Date(dateHdr);
      if (!Number.isNaN(parsed.getTime())) date = parsed;
    }
    const snippet = typeof data.snippet === 'string' ? data.snippet : '';
    const hasAttachments = payloadHasAttachments(data.payload ?? undefined);

    return {
      id,
      subject,
      from,
      to,
      date,
      preview: snippet.trim().slice(0, 300),
      hasAttachments,
      folder: folderHint ?? 'INBOX',
    } satisfies EmailMessage;
  }

  async sendMail(input: {
    to: string[];
    cc?: string[];
    subject: string;
    bodyText?: string;
    bodyHtml?: string;
  }): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    try {
      const gmail = this.gmail();
      let rawBody: string;
      if (input.bodyHtml?.trim()) {
        const nl = '\r\n';
        const boundary = `b_${Math.random().toString(36).slice(2)}`;
        rawBody =
          [`To: ${input.to.join(', ')}`,
            ...(input.cc?.length ? [`Cc: ${input.cc.join(', ')}`] : []),
            `Subject: ${input.subject}`,
            'MIME-Version: 1.0',
            `Content-Type: multipart/alternative; boundary="${boundary}"`,
            '',
            `--${boundary}`,
            'Content-Type: text/plain; charset="UTF-8"',
            '',
            input.bodyText ?? '(HTML message)',
            '',
            `--${boundary}`,
            'Content-Type: text/html; charset="UTF-8"',
            '',
            input.bodyHtml.trim(),
            '',
            `--${boundary}--`,
            ''].join(nl);
      } else {
        rawBody = buildPlainMime(input);
      }
      const encoded = Buffer.from(rawBody).toString('base64url');
      const sent = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encoded },
      });
      return { ok: true, messageId: sent.data.id ?? undefined };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }

  async modifyMail(input: {
    messageId: string;
    markRead?: boolean;
    archive?: boolean;
  }): Promise<{ ok: boolean; error?: string }> {
    try {
      const gmail = this.gmail();
      const remove: string[] = [];
      if (input.markRead) {
        remove.push('UNREAD');
      }
      if (input.archive) {
        remove.push('INBOX');
      }
      if (remove.length > 0) {
        await gmail.users.messages.modify({
          userId: 'me',
          id: input.messageId,
          requestBody: { removeLabelIds: remove },
        });
      }
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }

  invalidateCache(): void {
    this.oauthCache = undefined;
  }
}
