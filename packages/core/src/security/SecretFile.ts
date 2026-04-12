import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function defaultSecretPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
  return path.join(homeDir, '.enzo', 'secret.key');
}

export function ensureLocalSecret(secretPath = defaultSecretPath()): string {
  if (process.env.ENZO_SECRET && process.env.ENZO_SECRET.trim().length > 0) {
    return process.env.ENZO_SECRET;
  }

  try {
    if (fs.existsSync(secretPath)) {
      const secret = fs.readFileSync(secretPath, 'utf-8').trim();
      if (secret.length > 0) {
        process.env.ENZO_SECRET = secret;
        return secret;
      }
    }
  } catch (error) {
    console.warn('[SecretFile] Failed to read local secret file:', error);
  }

  const newSecret = crypto.randomBytes(32).toString('hex');
  try {
    const dir = path.dirname(secretPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(secretPath, `${newSecret}\n`, { encoding: 'utf-8', mode: 0o600 });
    console.log(`[SecretFile] ✓ Secret generated at ${secretPath}`);
  } catch (error) {
    console.error('[SecretFile] Failed to persist local secret file:', error);
  }

  process.env.ENZO_SECRET = newSecret;
  return newSecret;
}
