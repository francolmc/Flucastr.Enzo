/** How Enzo connects to the mailbox (`imap`: password + server; OAuth for Google/Microsoft). */
export type EmailProviderKind = 'imap' | 'google' | 'microsoft';

export interface ImapConnectionConfig {
  host: string;
  port: number;
  user: string;
}

export interface EmailAccountConfig {
  id: string;
  label: string;
  provider: EmailProviderKind;
  /**
   * IMAP provider: host/user required.
   * OAuth: optional mailbox address for display (`address` preferred).
   */
  imap?: ImapConnectionConfig;
  /** Mailbox address hint for Gmail/Graph UI (recommended for OAuth-only rows). */
  address?: string;
  /** Azure AD tenant: `common`, `consumers`, `organizations`, or tenant GUID. Default `common` (singular `consumer` is normalized to `consumers`). */
  microsoftTenantId?: string;
  enabled: boolean;
}

export interface EmailConfig {
  accounts: EmailAccountConfig[];
}

/** Segment for `login.microsoftonline.com/{tenant}/...`. Empty → `common`. Corrects typo `consumer` → `consumers`. */
export function normalizeMicrosoftTenantId(raw: string | undefined | null): string {
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (!t) return 'common';
  if (t.toLowerCase() === 'consumer') return 'consumers';
  return t;
}

/** JSON key in `config.system` for encrypted IMAP password. */
export function emailPasswordEncryptedKey(accountId: string): string {
  return `emailPassword_${accountId}Encrypted`;
}

/** JSON key in `config.system` for encrypted OAuth refresh token (Gmail / Microsoft). */
export function emailOAuthRefreshEncryptedKey(accountId: string): string {
  return `emailOAuthRefresh_${accountId}Encrypted`;
}
