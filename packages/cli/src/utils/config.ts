import fs from 'fs';
import path from 'path';
import { ConfigService, EncryptionService, ensureLocalSecret } from '@enzo/core';

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || '~';
}

export function getConfigPath(): string {
  return path.join(getHomeDir(), '.enzo', 'config.json');
}

export function configExists(): boolean {
  return fs.existsSync(getConfigPath());
}

export function createConfigService(): ConfigService {
  const enzoSecret = ensureLocalSecret();
  const encryptionService = new EncryptionService(enzoSecret);
  return new ConfigService(encryptionService);
}
