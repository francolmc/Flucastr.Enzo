import crypto from 'crypto';

/**
 * Service for encrypting and decrypting sensitive data (API keys)
 * Uses AES-256-GCM with a key derived from ENZO_SECRET using PBKDF2
 */
export class EncryptionService {
  private encryptionKey: Buffer;
  private readonly ALGORITHM = 'aes-256-gcm';
  private readonly KEY_LENGTH = 32; // 256 bits for AES-256
  private readonly SALT_LENGTH = 16;
  private readonly IV_LENGTH = 12; // Recommended for GCM
  private readonly TAG_LENGTH = 16;
  private readonly ITERATIONS = 100000; // PBKDF2 iterations

  constructor(secret: string) {
    if (!secret || secret.trim() === '') {
      throw new Error('ENZO_SECRET no está configurado. Inicializa el secreto local en ~/.enzo/secret.key');
    }

    // Derive encryption key from secret using PBKDF2
    // Use a fixed salt for consistency (derived from the algorithm name)
    const salt = crypto.createHash('sha256').update('enzo-encryption-salt').digest().slice(0, this.SALT_LENGTH);
    
    this.encryptionKey = crypto.pbkdf2Sync(
      secret,
      salt,
      this.ITERATIONS,
      this.KEY_LENGTH,
      'sha256'
    );
  }

  /**
   * Encrypt plaintext (usually an API key)
   * Returns a base64-encoded string containing: iv + encryptedData + authTag
   */
  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(this.IV_LENGTH);
    const cipher = crypto.createCipheriv(this.ALGORITHM, this.encryptionKey, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Combine: iv + encrypted + authTag
    const combined = Buffer.concat([iv, Buffer.from(encrypted, 'hex'), authTag]);
    
    // Return as base64 for safe storage
    return combined.toString('base64');
  }

  /**
   * Decrypt ciphertext (base64-encoded)
   * Extracts iv, encrypted data, and authTag, then decrypts
   */
  decrypt(ciphertext: string): string {
    try {
      const combined = Buffer.from(ciphertext, 'base64');
      
      // Extract components
      const iv = combined.slice(0, this.IV_LENGTH);
      const authTag = combined.slice(combined.length - this.TAG_LENGTH);
      const encrypted = combined.slice(this.IV_LENGTH, combined.length - this.TAG_LENGTH);
      
      const decipher = crypto.createDecipheriv(this.ALGORITHM, this.encryptionKey, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encrypted.toString('hex'), 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('[EncryptionService] Decryption failed:', error);
      throw new Error('Failed to decrypt data. Secret may be incorrect.');
    }
  }
}
