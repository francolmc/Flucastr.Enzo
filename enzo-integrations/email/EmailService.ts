import type { EmailAccountConfig } from '../config/emailConfig.js';
import type { ConfigService } from '../config/ConfigService.js';
import { GraphMailAdapter } from './GraphMailAdapter.js';
import { GmailMailAdapter } from './GmailMailAdapter.js';
import { IMAPClient, type EmailMessage, type IMAPClientOptions } from './IMAPClient.js';

export interface EmailQuery {
  accountId?: string;
  folder?: string;
  limit?: number;
  since?: Date;
  query?: string;
  /** When true, only unread messages in the folder (Gmail is:unread, Graph isRead eq false, IMAP \\Seen off). */
  unreadOnly?: boolean;
}

export interface EmailSendInput {
  accountId?: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
}

export interface EmailModifyInput {
  accountId?: string;
  /** Provider-native message id (from read/search email output). */
  messageId: string;
  markRead?: boolean;
  archive?: boolean;
}

export interface EmailServiceResult {
  success: boolean;
  messages?: EmailMessage[];
  accountsQueried?: string[];
  error?: string;
}

export interface EmailUnreadInboxRow {
  accountId: string;
  label: string;
  provider: EmailAccountConfig['provider'];
  unread: number;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface EmailModifyResult {
  success: boolean;
  error?: string;
}

/** Account rows as shown in GET /email/accounts (mask secrets). */
export type EmailAccountListRow = EmailAccountConfig & {
  hasPassword: boolean;
  hasOAuth: boolean;
};

/** True when Enzo can read mail for this account (IMAP password or OAuth refresh). */
function accountConfiguredForRead(configService: ConfigService, acc: EmailAccountConfig): boolean {
  if (!acc.enabled) return false;
  if (acc.provider === 'imap') {
    const pwd = configService.getEmailPassword(acc.id);
    return !!(pwd?.trim().length && acc.imap?.host && acc.imap.user);
  }
  return configService.hasEmailOAuthRefresh(acc.id);
}

export class EmailService {
  constructor(private readonly configService: ConfigService) {}

  getConfiguredAccounts(): EmailAccountConfig[] {
    const email = this.configService.getEmailConfig();
    return email.accounts.filter((a) => accountConfiguredForRead(this.configService, a));
  }

  listAccounts(): EmailAccountListRow[] {
    const email = this.configService.getEmailConfig();
    return email.accounts.map((a) => ({
      ...a,
      ...(a.imap ? { imap: { ...a.imap } } : {}),
      hasPassword: this.configService.hasEmailPassword(a.id),
      hasOAuth: this.configService.hasEmailOAuthRefresh(a.id),
    }));
  }

  /** OAuth Gmail/Outlook accounts usable for send / archive / etc. */
  hasMutationCapableAccount(): boolean {
    return this.getConfiguredAccounts().some(
      (a) =>
        (a.provider === 'google' || a.provider === 'microsoft') &&
        this.configService.hasEmailOAuthRefresh(a.id)
    );
  }

  async getRecent(options: EmailQuery): Promise<EmailServiceResult> {
    try {
      const configured = this.getConfiguredAccounts();
      const accounts =
        options.accountId != null && options.accountId !== ''
          ? configured.filter((c) => c.id === options.accountId)
          : configured;
      if (accounts.length === 0) {
        return {
          success: false,
          error:
            options.accountId != null
              ? `No enabled email account with credentials: ${options.accountId}`
              : 'No enabled email accounts with saved credentials (IMAP password or OAuth)',
        };
      }

      const merged: EmailMessage[] = [];
      const ids: string[] = [];
      const limit = Math.max(1, Math.min(100, options.limit ?? 10));
      const folder = options.folder ?? 'INBOX';
      const unreadOnly = !!options.unreadOnly;
      const perAccountFetch =
        accounts.length > 1 && !(options.accountId != null && options.accountId !== '')
          ? Math.min(50, Math.max(5, Math.ceil(limit / accounts.length)))
          : limit;

      for (const acc of accounts) {
        ids.push(acc.id);
        const batch = await this.recentForAccount(acc, {
          folder,
          limit: perAccountFetch,
          since: options.since,
          unreadOnly,
        });
        for (const m of batch) {
          merged.push({
            ...m,
            accountId: acc.id,
            accountLabel: acc.label,
          });
        }
      }

      merged.sort((a, b) => b.date.getTime() - a.date.getTime());
      const capped = merged.slice(0, limit);
      return {
        success: true,
        messages: capped,
        accountsQueried: ids,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  }

  /** Unread count per configured account (INBOX / equivalent). */
  async getUnreadInboxCounts(accountIdFilter?: string): Promise<{
    success: boolean;
    rows?: EmailUnreadInboxRow[];
    error?: string;
  }> {
    try {
      const configured = this.getConfiguredAccounts();
      const accounts =
        accountIdFilter != null && accountIdFilter !== ''
          ? configured.filter((c) => c.id === accountIdFilter)
          : configured;
      if (accounts.length === 0) {
        return {
          success: false,
          error:
            accountIdFilter?.trim()
              ? `No cuenta con credenciales: ${accountIdFilter}`
              : 'No hay cuentas habilitadas con credenciales de correo',
        };
      }
      const rows: EmailUnreadInboxRow[] = [];
      for (const acc of accounts) {
        try {
          const unread = await this.unreadCountForAccount(acc);
          rows.push({
            accountId: acc.id,
            label: acc.label,
            provider: acc.provider,
            unread,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { success: false, error: `Cuenta ${acc.id}: ${msg}` };
        }
      }
      return { success: true, rows };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  }

  async search(options: EmailQuery): Promise<EmailServiceResult> {
    const q = options.query?.trim();
    if (!q) {
      return { success: false, error: 'Search query is required' };
    }
    try {
      const configured = this.getConfiguredAccounts();
      const accounts =
        options.accountId != null && options.accountId !== ''
          ? configured.filter((c) => c.id === options.accountId)
          : configured;
      if (accounts.length === 0) {
        return {
          success: false,
          error: 'No enabled email accounts with credentials',
        };
      }

      const merged: EmailMessage[] = [];
      const ids: string[] = [];
      const limit = options.limit ?? 10;
      const folder = options.folder ?? 'INBOX';

      for (const acc of accounts) {
        ids.push(acc.id);
        const batch = await this.searchForAccount(acc, {
          query: q,
          folder,
          limit,
          since: options.since,
        });
        for (const m of batch) {
          merged.push({
            ...m,
            accountId: acc.id,
            accountLabel: acc.label,
          });
        }
      }

      merged.sort((a, b) => b.date.getTime() - a.date.getTime());
      const capped = merged.slice(0, limit);
      return {
        success: true,
        messages: capped,
        accountsQueried: ids,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  }

  async testAccount(accountId: string): Promise<boolean> {
    const r = await this.testAccountWithError(accountId);
    return r.ok;
  }

  async testAccountWithError(accountId: string): Promise<{ ok: boolean; error?: string }> {
    const accounts = this.configService.getEmailConfig().accounts;
    const acc = accounts.find((a) => a.id === accountId);
    if (!acc) {
      return { ok: false, error: `Unknown account: ${accountId}` };
    }
    if (!acc.enabled) {
      return { ok: false, error: 'Account disabled' };
    }

    if (acc.provider === 'imap') {
      const pwd = this.configService.getEmailPassword(accountId);
      if (!pwd) {
        return { ok: false, error: 'No IMAP password saved' };
      }
      if (!acc.imap?.host || !acc.imap.user) {
        return { ok: false, error: 'Incomplete IMAP config' };
      }
      const client = new IMAPClient(this.toImapOptions(acc as EmailAccountConfig & { imap: NonNullable<EmailAccountConfig['imap']> }, pwd));
      return client.diagnose();
    }

    if (acc.provider === 'google') {
      if (!this.configService.hasEmailOAuthRefresh(accountId)) {
        return { ok: false, error: 'Gmail OAuth not connected' };
      }
      const g = new GmailMailAdapter(this.configService, accountId);
      return g.testConnection();
    }

    if (acc.provider === 'microsoft') {
      if (!this.configService.hasEmailOAuthRefresh(accountId)) {
        return { ok: false, error: 'Microsoft OAuth not connected' };
      }
      const g = new GraphMailAdapter(this.configService, accountId);
      return g.testConnection();
    }

    return { ok: false, error: `Unknown provider ${(acc as EmailAccountConfig).provider}` };
  }

  async sendMail(input: EmailSendInput): Promise<EmailSendResult> {
    try {
      if (!input.to?.length) {
        return { success: false, error: '"to" must include at least one address' };
      }
      const acc = this.resolveMutationAccount(input.accountId);
      const subj = typeof input.subject === 'string' ? input.subject.trim() : '';
      if (!subj) {
        return { success: false, error: 'subject is required' };
      }

      if (acc.provider === 'google') {
        const gmail = new GmailMailAdapter(this.configService, acc.id);
        const r = await gmail.sendMail({
          to: input.to,
          cc: input.cc,
          subject: subj,
          bodyText: input.bodyText,
          bodyHtml: input.bodyHtml,
        });
        if (!r.ok) {
          return { success: false, error: r.error ?? 'Send failed' };
        }
        return { success: true, messageId: r.messageId };
      }

      const graph = new GraphMailAdapter(this.configService, acc.id);
      const r = await graph.sendMail({
        to: input.to,
        cc: input.cc,
        subject: subj,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml,
      });
      if (!r.ok) {
        return { success: false, error: r.error ?? 'Send failed' };
      }
      return { success: true, messageId: r.messageId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: msg };
    }
  }

  async modifyMail(input: EmailModifyInput): Promise<EmailModifyResult> {
    try {
      const id = typeof input.messageId === 'string' ? input.messageId.trim() : '';
      if (!id) {
        return { success: false, error: 'messageId is required' };
      }
      if (!input.markRead && !input.archive) {
        return { success: false, error: 'Pass markRead and/or archive' };
      }
      const acc = this.resolveMutationAccount(input.accountId);

      if (acc.provider === 'google') {
        const gmail = new GmailMailAdapter(this.configService, acc.id);
        const r = await gmail.modifyMail({
          messageId: id,
          markRead: input.markRead,
          archive: input.archive,
        });
        return r.ok ? { success: true } : { success: false, error: r.error ?? 'Modify failed' };
      }

      const graph = new GraphMailAdapter(this.configService, acc.id);
      const r = await graph.modifyMail({
        messageId: id,
        markRead: input.markRead,
        archive: input.archive,
      });
      return r.ok ? { success: true } : { success: false, error: r.error ?? 'Modify failed' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: msg };
    }
  }

  private resolveMutationAccount(accountId?: string): EmailAccountConfig {
    const candidates = this.configService
      .getEmailConfig()
      .accounts.filter(
        (a) =>
          a.enabled &&
          (a.provider === 'google' || a.provider === 'microsoft') &&
          this.configService.hasEmailOAuthRefresh(a.id)
      );

    if (accountId && accountId.trim()) {
      const one = candidates.find((c) => c.id === accountId.trim());
      if (!one) {
        throw new Error(
          `No OAuth mailbox for account "${accountId}" (connect Gmail/Outlook with OAuth first).`
        );
      }
      return one;
    }

    if (candidates.length === 0) {
      throw new Error('No Gmail/Outlook OAuth mailbox connected.');
    }
    if (candidates.length > 1) {
      throw new Error(`Several OAuth mailboxes: pass accountId. Options: ${candidates.map((c) => c.id).join(', ')}`);
    }
    return candidates[0];
  }

  private async recentForAccount(
    acc: EmailAccountConfig,
    opts: { folder: string; limit: number; since?: Date; unreadOnly?: boolean }
  ): Promise<EmailMessage[]> {
    const { folder, limit, since, unreadOnly } = opts;
    if (acc.provider === 'imap') {
      const pwd = this.configService.getEmailPassword(acc.id);
      if (!pwd || !acc.imap?.host || !acc.imap.user) return [];
      const client = new IMAPClient(this.toImapOptions(acc as EmailAccountConfig & { imap: NonNullable<EmailAccountConfig['imap']> }, pwd));
      return client.getRecent({ folder, limit, since, unreadOnly });
    }
    if (acc.provider === 'google') {
      const g = new GmailMailAdapter(this.configService, acc.id);
      return g.getRecent({ folder, limit, since, unreadOnly });
    }
    if (acc.provider === 'microsoft') {
      const g = new GraphMailAdapter(this.configService, acc.id);
      return g.getRecent({ folder, limit, since, unreadOnly });
    }
    return [];
  }

  private async unreadCountForAccount(acc: EmailAccountConfig): Promise<number> {
    if (acc.provider === 'imap') {
      const pwd = this.configService.getEmailPassword(acc.id);
      if (!pwd || !acc.imap?.host || !acc.imap.user) return 0;
      const client = new IMAPClient(this.toImapOptions(acc as EmailAccountConfig & { imap: NonNullable<EmailAccountConfig['imap']> }, pwd));
      return client.countUnseen({ folder: 'INBOX' });
    }
    if (acc.provider === 'google') {
      const g = new GmailMailAdapter(this.configService, acc.id);
      return g.getInboxUnreadCount();
    }
    if (acc.provider === 'microsoft') {
      const g = new GraphMailAdapter(this.configService, acc.id);
      return g.getInboxUnreadCount();
    }
    return 0;
  }

  private async searchForAccount(
    acc: EmailAccountConfig,
    opts: { query: string; folder: string; limit: number; since?: Date }
  ): Promise<EmailMessage[]> {
    const { query, folder, limit, since } = opts;
    if (acc.provider === 'imap') {
      const pwd = this.configService.getEmailPassword(acc.id);
      if (!pwd || !acc.imap?.host || !acc.imap.user) return [];
      const client = new IMAPClient(this.toImapOptions(acc as EmailAccountConfig & { imap: NonNullable<EmailAccountConfig['imap']> }, pwd));
      return client.search({ query, folder, limit, since });
    }
    if (acc.provider === 'google') {
      const g = new GmailMailAdapter(this.configService, acc.id);
      return g.search({ query, folder, limit, since });
    }
    if (acc.provider === 'microsoft') {
      const g = new GraphMailAdapter(this.configService, acc.id);
      return g.search({ query, folder, limit, since });
    }
    return [];
  }

  private toImapOptions(acc: EmailAccountConfig & { imap: NonNullable<EmailAccountConfig['imap']> }, password: string): IMAPClientOptions {
    return {
      host: acc.imap.host,
      port: acc.imap.port || 993,
      user: acc.imap.user,
      password,
    };
  }
}
