import { refreshMicrosoftAccessToken } from './oauth/exchange.js';

import type { ConfigService } from '../config/ConfigService.js';
import { normalizeMicrosoftTenantId } from '../config/emailConfig.js';
import type { EmailMessage } from './IMAPClient.js';

interface GraphMessageLite {
  id: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  hasAttachments?: boolean;
}

function formatMailbox(mail: { name?: string; address?: string } | undefined): string {
  const address = mail?.address;
  const name = mail?.name;
  const a = address?.trim();
  if (!a) return '';
  const n = name?.trim();
  if (n) {
    return `${n} <${a}>`;
  }
  return a;
}

function graphFolderSegment(folder?: string): string {
  const f = folder || 'INBOX';
  if (f.toUpperCase() === 'INBOX') return 'inbox';
  return encodeURIComponent(f);
}

/** Microsoft Graph Mail backend for OAuth-backed accounts (`provider: microsoft`). */
export class GraphMailAdapter {
  private accessToken: string | null = null;
  private accessTokenExpiresAtMs = 0;
  private archiveFolderId: string | undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly accountId: string
  ) {}

  private tenant(): string {
    const accounts = this.configService.getEmailConfig().accounts;
    const acc = accounts.find((a) => a.id === this.accountId);
    return normalizeMicrosoftTenantId(acc?.microsoftTenantId);
  }

  private getRefreshToken(): string | null {
    return this.configService.getEmailOAuthRefreshToken(this.accountId);
  }

  private persistRefreshTokenIfNeeded(next?: string | undefined): void {
    if (next && next.length > 0) {
      this.configService.setEmailOAuthRefreshToken(this.accountId, next);
    }
  }

  private async ensureAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.accessTokenExpiresAtMs - 30_000) {
      return this.accessToken;
    }
    const rt = this.getRefreshToken();
    if (!rt) {
      throw new Error(`No Microsoft OAuth refresh token for account ${this.accountId}`);
    }
    const { clientId, clientSecret } = this.configService.getMicrosoftOAuthCredentials();
    if (!clientId) {
      throw new Error('Microsoft OAuth client id not configured (ENZO_MICROSOFT_CLIENT_ID)');
    }
    const refreshed = await refreshMicrosoftAccessToken({
      tenant: this.tenant(),
      clientId,
      clientSecret,
      refreshToken: rt,
    });
    this.accessToken = refreshed.access_token;
    this.accessTokenExpiresAtMs = Date.now() + (refreshed.expires_in ?? 3600) * 1000;
    this.persistRefreshTokenIfNeeded(refreshed.refresh_token);
    return this.accessToken;
  }

  private async graphFetch(path: string, init?: RequestInit): Promise<Response> {
    const token = await this.ensureAccessToken();
    const url = path.startsWith('http') ? path : `https://graph.microsoft.com/v1.0${path}`;
    return fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.headers || {}),
      },
    });
  }

  private async resolveArchiveFolderId(): Promise<string> {
    if (this.archiveFolderId) return this.archiveFolderId;
    const r = await this.graphFetch('/me/mailFolders/archive');
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Graph archive folder: ${r.status} ${t}`);
    }
    const j = (await r.json()) as { id?: string };
    if (!j.id) {
      throw new Error('Graph archive folder missing id');
    }
    this.archiveFolderId = j.id;
    return j.id;
  }

  /** Unread messages in Well-Known Folder `inbox` (Graph `unreadItemCount`). */
  async getInboxUnreadCount(): Promise<number> {
    const r = await this.graphFetch('/me/mailFolders/inbox?$select=unreadItemCount');
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Graph inbox unread: ${r.status} ${t}`);
    }
    const j = (await r.json()) as { unreadItemCount?: number };
    const n = j.unreadItemCount;
    return typeof n === 'number' && Number.isFinite(n) ? n : 0;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const r = await this.graphFetch('/me?$select=displayName,mail');
      if (!r.ok) {
        const t = await r.text();
        return { ok: false, error: `${r.status} ${t}` };
      }
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }

  private toEmailMessage(row: GraphMessageLite, folderLabel: string): EmailMessage {
    const fromAddr = row.from?.emailAddress;
    const toList =
      row.toRecipients
        ?.map((tr) => formatMailbox(tr.emailAddress))
        .filter((x) => x.length > 0) ?? [];

    let date = new Date();
    if (row.receivedDateTime) {
      const d = new Date(row.receivedDateTime);
      if (!Number.isNaN(d.getTime())) date = d;
    }

    const preview =
      typeof row.bodyPreview === 'string' ? row.bodyPreview.replace(/\s+/g, ' ').trim().slice(0, 300) : '';

    return {
      id: row.id,
      subject: typeof row.subject === 'string' && row.subject.trim() ? row.subject : '(sin asunto)',
      from: formatMailbox(fromAddr) || '(sin remitente)',
      to: toList,
      date,
      preview,
      hasAttachments: !!row.hasAttachments,
      folder: folderLabel,
    };
  }

  async getRecent(opts: {
    folder?: string;
    limit: number;
    since?: Date;
    unreadOnly?: boolean;
  }): Promise<EmailMessage[]> {
    const folderSeg = graphFolderSegment(opts.folder);
    const qp: string[] = [
      `$top=${encodeURIComponent(String(opts.limit))}`,
      `$orderby=${encodeURIComponent('receivedDateTime desc')}`,
      `$select=${encodeURIComponent('id,subject,bodyPreview,receivedDateTime,from,toRecipients,hasAttachments,isRead')}`,
    ];
    const filterParts: string[] = [];
    if (opts.unreadOnly) filterParts.push('isRead eq false');
    if (opts.since && !Number.isNaN(opts.since.getTime())) {
      filterParts.push(`receivedDateTime ge ${opts.since.toISOString()}`);
    }
    if (filterParts.length > 0) {
      qp.push(`$filter=${encodeURIComponent(filterParts.join(' and '))}`);
    }

    const url = `/me/mailFolders/${folderSeg}/messages?${qp.join('&')}`;
    const r = await this.graphFetch(url);
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Graph list messages failed: ${r.status} ${t}`);
    }

    const j = (await r.json()) as { value?: GraphMessageLite[] };
    const list = Array.isArray(j.value) ? j.value : [];

    const folderLabel = opts.folder ?? 'INBOX';
    return list.map((row) => this.toEmailMessage(row, folderLabel));
  }

  async search(opts: { query: string; folder?: string; limit: number; since?: Date }): Promise<EmailMessage[]> {
    const trimmed = opts.query.trim();
    if (!trimmed) return [];

    const esc = trimmed.replace(/"/g, `'`);
    const path =
      `/me/messages?$search=${encodeURIComponent(`"${esc}"`)}` +
      `&$top=${encodeURIComponent(String(opts.limit))}` +
      `&$select=${encodeURIComponent('id,subject,bodyPreview,receivedDateTime,from,toRecipients,hasAttachments')}` +
      `&$orderby=${encodeURIComponent('receivedDateTime desc')}`;

    const r = await this.graphFetch(path, {
      headers: { ConsistencyLevel: 'eventual' },
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Graph search failed: ${r.status} ${t}`);
    }

    const j = (await r.json()) as { value?: GraphMessageLite[] };
    const list = Array.isArray(j.value) ? j.value : [];
    const folderLabel = opts.folder ?? 'SEARCH';
    return list.map((row) => this.toEmailMessage(row, folderLabel));
  }

  async sendMail(input: {
    to: string[];
    cc?: string[];
    subject: string;
    bodyText?: string;
    bodyHtml?: string;
  }): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    try {
      const contentType: 'Text' | 'HTML' = input.bodyHtml?.trim() ? 'HTML' : 'Text';
      const content = input.bodyHtml?.trim()?.length ? input.bodyHtml!.trim() : (input.bodyText ?? '');

      const body = {
        message: {
          subject: input.subject,
          body: { contentType, content },
          toRecipients: input.to.map((a) => ({ emailAddress: { address: a } })),
          ...(input.cc?.length
            ? { ccRecipients: input.cc.map((a) => ({ emailAddress: { address: a } })) }
            : {}),
        },
        saveToSentItems: true,
      };

      const r = await this.graphFetch('/me/sendMail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!r.ok && r.status !== 202 && r.status !== 200) {
        const t = await r.text();
        return { ok: false, error: `${r.status} ${t}` };
      }
      return { ok: true };
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
      const id = encodeURIComponent(input.messageId);
      if (input.markRead) {
        const r = await this.graphFetch(`/me/messages/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isRead: true }),
        });
        if (!r.ok) {
          const t = await r.text();
          return { ok: false, error: `${r.status} ${t}` };
        }
      }
      if (input.archive) {
        const archiveId = await this.resolveArchiveFolderId();
        const r = await this.graphFetch(`/me/messages/${id}/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ destinationId: archiveId }),
        });
        if (!r.ok) {
          const t = await r.text();
          return { ok: false, error: `${r.status} ${t}` };
        }
      }
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }
}
