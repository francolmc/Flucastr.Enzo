export interface EmailAccountConfig {
  id: string;
  label: string;
  imap: {
    host: string;
    port: number;
    user: string;
  };
  enabled: boolean;
}

export interface EmailConfig {
  accounts: EmailAccountConfig[];
}

/** JSON key in `config.system` for encrypted IMAP password. */
export function emailPasswordEncryptedKey(accountId: string): string {
  return `emailPassword_${accountId}Encrypted`;
}
