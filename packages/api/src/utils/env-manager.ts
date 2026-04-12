import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE_PATH = path.resolve(__dirname, '../../../../.env');

/**
 * Ensure ENZO_SECRET exists in .env
 * If missing, generate a new 32-byte random hex string and append to .env
 */
export function ensureEnzoSecret(): string {
  // Check if ENZO_SECRET is already in process.env
  if (process.env.ENZO_SECRET) {
    console.log('[EnvManager] ✓ ENZO_SECRET found in environment');
    return process.env.ENZO_SECRET;
  }

  // Try to read from .env file
  try {
    if (fs.existsSync(ENV_FILE_PATH)) {
      const envContent = fs.readFileSync(ENV_FILE_PATH, 'utf-8');
      const secretMatch = envContent.match(/^ENZO_SECRET=(.+)$/m);
      
      if (secretMatch && secretMatch[1]) {
        const secret = secretMatch[1].trim();
        console.log('[EnvManager] ✓ ENZO_SECRET found in .env file');
        process.env.ENZO_SECRET = secret;
        return secret;
      }
    }
  } catch (error) {
    console.warn('[EnvManager] Could not read .env file:', error);
  }

  // Generate new secret
  console.log('[EnvManager] Generating new ENZO_SECRET...');
  const newSecret = crypto.randomBytes(32).toString('hex');

  // Append to .env file
  try {
    const envContent = fs.existsSync(ENV_FILE_PATH) 
      ? fs.readFileSync(ENV_FILE_PATH, 'utf-8')
      : '';

    const newContent = envContent + (envContent && !envContent.endsWith('\n') ? '\n' : '') + 
      `ENZO_SECRET=${newSecret}\n`;

    fs.writeFileSync(ENV_FILE_PATH, newContent, 'utf-8');
    console.log('[EnvManager] ✓ ENZO_SECRET generated and saved to .env');
  } catch (error) {
    console.error('[EnvManager] Failed to write ENZO_SECRET to .env:', error);
    console.warn('[EnvManager] Using generated secret in memory (not persistent)');
  }

  // Set in process.env
  process.env.ENZO_SECRET = newSecret;
  
  return newSecret;
}
