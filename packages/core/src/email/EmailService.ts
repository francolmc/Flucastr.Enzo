import type { EmailAccountConfig } from '../config/emailConfig.js';
import type { ConfigService } from '../config/ConfigService.js';
import { IMAPClient, type EmailMessage, type IMAPClientOptions } from './IMAPClient.js';

export interface EmailQuery {
  accountId?: string;
  folder?: string;
  limit?: number;
  since?: Date;
  query?: string;
}

export interface EmailServiceResult {
  success: boolean;
  messages?: EmailMessage[];
  accountsQueried?: string[];
  error?: string;
}

export class EmailService {
  constructor(private readonly configService: ConfigService) {}

  getConfiguredAccounts(): EmailAccountConfig[] {
    const email = this.configService.getEmailConfig();
    return email.accounts.filter(
      (a) =>
        a.enabled &&
        !!this.configService.getEmailPassword(a.id)?.trim() &&
        a.imap.host &&
        a.imap.user
    );
  }

  /** Accounts listed in config with optional password (for UI badges). */
  listAccounts(): Array<EmailAccountConfig & { hasPassword: boolean }> {
    const email = this.configService.getEmailConfig();
    return email.accounts.map((a) => ({
      ...a,
      imap: { ...a.imap },
      hasPassword: this.configService.hasEmailPassword(a.id),
    }));
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
              : 'No enabled email accounts with saved passwords',
        };
      }

      const merged: EmailMessage[] = [];
      const ids: string[] = [];
      const limit = options.limit ?? 10;
      const folder = options.folder ?? 'INBOX';

      for (const acc of accounts) {
        const pwd = this.configService.getEmailPassword(acc.id);
        if (!pwd) continue;
        ids.push(acc.id);
        const client = new IMAPClient(this.toImapOptions(acc, pwd));
        const batch = await client.getRecent({
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
          error: 'No enabled email accounts with saved passwords',
        };
      }

      const merged: EmailMessage[] = [];
      const ids: string[] = [];
      const limit = options.limit ?? 10;
      const folder = options.folder ?? 'INBOX';

      for (const acc of accounts) {
        const pwd = this.configService.getEmailPassword(acc.id);
        if (!pwd) continue;
        ids.push(acc.id);
        const client = new IMAPClient(this.toImapOptions(acc, pwd));
        const batch = await client.search({
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
    const accounts = this.configService.getEmailConfig().accounts;
    const acc = accounts.find((a) => a.id === accountId);
    if (!acc || !acc.enabled) return false;
    const pwd = this.configService.getEmailPassword(accountId);
    if (!pwd) return false;
    const client = new IMAPClient(this.toImapOptions(acc, pwd));
    return client.testConnection();
  }

  async testAccountWithError(accountId: string): Promise<{ ok: boolean; error?: string }> {
    const accounts = this.configService.getEmailConfig().accounts;
    const acc = accounts.find((a) => a.id === accountId);
    if (!acc) {
      return { ok: false, error: `Unknown account: ${accountId}` };
    }
    const pwd = this.configService.getEmailPassword(accountId);
    if (!pwd) {
      return { ok: false, error: 'No password saved for this account' };
    }
    const client = new IMAPClient(this.toImapOptions(acc, pwd));
    const d = await client.diagnose();
    return d.ok ? { ok: true } : { ok: false, error: d.error };
  }

  private toImapOptions(acc: EmailAccountConfig, password: string): IMAPClientOptions {
    return {
      host: acc.imap.host,
      port: acc.imap.port || 993,
      user: acc.imap.user,
      password,
    };
  }
}
