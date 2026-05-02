import { ImapFlow } from 'imapflow';

const OPERATION_TIMEOUT_MS = 15_000;
const PREVIEW_MAX = 300;

export interface EmailMessage {
  id: string;
  subject: string;
  from: string;
  to: string[];
  date: Date;
  preview: string;
  hasAttachments: boolean;
  folder: string;
  /** Set when merging results from several accounts (EmailService). */
  accountId?: string;
  accountLabel?: string;
}

export interface IMAPClientOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  /** Optional test hook: injected constructor instead of `ImapFlow` from `imapflow`. */
  imapCtor?: typeof ImapFlow;
}

function stripHtmlForPreview(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatAddressList(
  list: Array<{ name?: string; address?: string }> | undefined
): string[] {
  if (!list?.length) return [];
  return list.map((a) => {
    const addr = a.address || '';
    if (a.name && a.name.trim()) {
      return `${a.name} <${addr}>`;
    }
    return addr;
  });
}

function formatFrom(
  list: Array<{ name?: string; address?: string }> | undefined
): string {
  const parts = formatAddressList(list);
  return parts[0] || '(sin remitente)';
}

function envelopeDate(env: { date?: Date } | undefined, internal?: Date | string): Date {
  if (internal) {
    const d = typeof internal === 'string' ? new Date(internal) : internal;
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (env?.date) return env.date;
  return new Date(0);
}

function walkStructureHasAttachments(struct: unknown): boolean {
  if (!struct || typeof struct !== 'object') return false;
  const s = struct as {
    type?: string;
    disposition?: string;
    childNodes?: unknown[];
  };
  const d = (s.disposition || '').toLowerCase();
  if (d === 'attachment' || d === 'inline') {
    const t = (s.type || '').toLowerCase();
    if (t && t !== 'text/plain' && t !== 'text/html' && t !== 'multipart/alternative') {
      return true;
    }
  }
  if (s.type?.toLowerCase().startsWith('multipart/') && s.childNodes) {
    for (const c of s.childNodes) {
      if (walkStructureHasAttachments(c)) return true;
    }
  }
  return false;
}

function plainPreviewFromSource(raw: string): string {
  const lower = raw.slice(0, Math.min(raw.length, 120_000)).toLowerCase();
  const htmlIdx = lower.indexOf('text/html');
  const plainIdx = lower.indexOf('text/plain');
  if (plainIdx >= 0 && (htmlIdx < 0 || plainIdx < htmlIdx)) {
    const boundaryMatch = raw.match(/boundary="?([^"\s;]+)"?/i);
    if (boundaryMatch) {
      const b = boundaryMatch[1];
      const parts = raw.split(`--${b}`);
      for (const part of parts) {
        if (part.toLowerCase().includes('content-type: text/plain')) {
          const bodyStart = part.search(/\r?\n\r?\n/);
          if (bodyStart >= 0) {
            let body = part.slice(bodyStart).replace(/^\s+/, '');
            body = body.replace(/^[\s\S]*?\n\n/, '');
            return body.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_MAX);
          }
        }
      }
    }
  }
  if (htmlIdx >= 0 || lower.includes('<html') || lower.includes('<body')) {
    return stripHtmlForPreview(raw).slice(0, PREVIEW_MAX);
  }
  return raw.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_MAX);
}

export class IMAPClient {
  constructor(private readonly options: IMAPClientOptions) {}

  protected createFlow(): ImapFlow {
    const Ctor = this.options.imapCtor ?? ImapFlow;
    return new Ctor({
      host: this.options.host,
      port: this.options.port,
      secure: true,
      auth: {
        user: this.options.user,
        pass: this.options.password,
      },
      connectionTimeout: OPERATION_TIMEOUT_MS,
      greetingTimeout: OPERATION_TIMEOUT_MS,
      socketTimeout: OPERATION_TIMEOUT_MS,
      logger: false,
    });
  }

  private async withTimeout<T>(label: string, fn: () => Promise<T>): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(`${label}: timeout after ${OPERATION_TIMEOUT_MS / 1000}s (${this.options.host}:${this.options.port})`)
          );
        }, OPERATION_TIMEOUT_MS);
      }),
    ]);
  }

  private async withConnection<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = this.createFlow();
    try {
      await this.withTimeout('connect', () => client.connect());
      return await this.withTimeout('operation', () => fn(client));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/AUTHENTICATIONFAILED|Invalid credentials|Login failed/i.test(msg)) {
        throw new Error(`IMAP authentication failed for ${this.options.user}@${this.options.host}: ${msg}`);
      }
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      try {
        await client.logout();
      } catch {
        /* ignore logout errors */
      }
    }
  }

  async getRecent(options: {
    folder?: string;
    limit?: number;
    since?: Date;
  }): Promise<EmailMessage[]> {
    const folder = options.folder ?? 'INBOX';
    const limit = Math.max(1, Math.min(100, options.limit ?? 10));
    const since = options.since;

    return this.withConnection(async (client) => {
      await client.mailboxOpen(folder);
      const mb = client.mailbox;
      const exists = mb && typeof mb === 'object' ? mb.exists : 0;
      if (exists === 0) {
        return [];
      }

      const out: EmailMessage[] = [];
      if (!since) {
        const startSeq = Math.max(1, exists - limit + 1);
        for await (const msg of client.fetch(`${startSeq}:*`, {
          envelope: true,
          internalDate: true,
          uid: true,
          bodyStructure: true,
          source: { maxLength: 96_000 },
        })) {
          out.push(this.mapFetchToMessage(msg, folder));
        }
        out.sort((a, b) => b.date.getTime() - a.date.getTime());
        return out.slice(0, limit);
      }

      const searched = await client.search({ since });
      let uids = searched === false ? [] : searched;
      uids.sort((a, b) => b - a);
      const slice = uids.slice(0, limit);

      for await (const msg of client.fetch(slice, {
        envelope: true,
        internalDate: true,
        uid: true,
        bodyStructure: true,
        source: { maxLength: 96_000 },
      }, { uid: true })) {
        out.push(this.mapFetchToMessage(msg, folder));
      }

      out.sort((a, b) => b.date.getTime() - a.date.getTime());
      return out;
    });
  }

  private mapFetchToMessage(
    msg: {
      uid?: number;
      envelope?: import('imapflow').MessageEnvelopeObject;
      internalDate?: Date | string;
      source?: Buffer;
      bodyStructure?: import('imapflow').MessageStructureObject;
    },
    folder: string
  ): EmailMessage {
    const uid = typeof msg.uid === 'bigint' ? Number(msg.uid) : Number(msg.uid ?? 0);
    const env = msg.envelope;
    const subject = typeof env?.subject === 'string' ? env.subject : '(sin asunto)';
    const date = envelopeDate(env, msg.internalDate);
    let preview = '';
    if (msg.source) {
      preview = plainPreviewFromSource(msg.source.toString());
    }
    const hasAttachments = msg.bodyStructure ? walkStructureHasAttachments(msg.bodyStructure) : false;
    const to = formatAddressList(env?.to);
    return {
      id: String(uid),
      subject,
      from: formatFrom(env?.from),
      to,
      date,
      preview: preview.slice(0, PREVIEW_MAX),
      hasAttachments,
      folder,
    };
  }

  async search(options: {
    query: string;
    folder?: string;
    limit?: number;
    since?: Date;
  }): Promise<EmailMessage[]> {
    const folder = options.folder ?? 'INBOX';
    const limit = Math.max(1, Math.min(100, options.limit ?? 10));
    const q = options.query.trim();
    if (!q) {
      return [];
    }

    return this.withConnection(async (client) => {
      await client.mailboxOpen(folder);
      const searchedOr = await client.search({
        or: [{ from: q }, { subject: q }, { text: q }],
      });
      let uids = searchedOr === false ? [] : searchedOr;
      if (options.since) {
        const sinceTime = options.since.getTime();
        const filtered: number[] = [];
        for await (const msg of client.fetch(uids, { uid: true, internalDate: true, envelope: true }, { uid: true })) {
          const d = envelopeDate(msg.envelope, msg.internalDate);
          if (d.getTime() >= sinceTime) {
            const uid = typeof msg.uid === 'bigint' ? Number(msg.uid) : Number(msg.uid);
            filtered.push(uid);
          }
        }
        uids = filtered;
      }
      uids.sort((a, b) => b - a);
      const slice = uids.slice(0, limit);

      const out: EmailMessage[] = [];
      for await (const msg of client.fetch(slice, {
        envelope: true,
        internalDate: true,
        uid: true,
        bodyStructure: true,
        source: { maxLength: 96_000 },
      })) {
        const uid = typeof msg.uid === 'bigint' ? Number(msg.uid) : Number(msg.uid);
        const env = msg.envelope;
        const subject = typeof env?.subject === 'string' ? env.subject : '(sin asunto)';
        const date = envelopeDate(env, msg.internalDate);
        let preview = '';
        if (msg.source) {
          preview = plainPreviewFromSource(msg.source.toString());
        }
        const hasAttachments = msg.bodyStructure
          ? walkStructureHasAttachments(msg.bodyStructure)
          : false;
        out.push({
          id: String(uid),
          subject,
          from: formatFrom(env?.from),
          to: formatAddressList(env?.to),
          date,
          preview: preview.slice(0, PREVIEW_MAX),
          hasAttachments,
          folder,
        });
      }
      out.sort((a, b) => b.date.getTime() - a.date.getTime());
      return out;
    });
  }

  /** Count UNSEEN in folder (typically INBOX) via SEARCH. */
  async countUnseen(options?: { folder?: string }): Promise<number> {
    const folder = options?.folder ?? 'INBOX';
    return this.withConnection(async (client) => {
      await client.mailboxOpen(folder);
      const uids = await client.search({ seen: false });
      if (uids === false) return 0;
      return uids.length;
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.probeInbox();
      return true;
    } catch {
      return false;
    }
  }

  /** Same as connecting and opening INBOX; returns structured error when it fails (for APIs). */
  async diagnose(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.probeInbox();
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  private async probeInbox(): Promise<void> {
    await this.withConnection(async (client) => {
      await client.mailboxOpen('INBOX');
      if (!client.mailbox) {
        throw new Error('INBOX not available');
      }
    });
  }
}
