import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const CIPHER_VERSION = 'v1';

function encryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('Protected tax identifier storage is unavailable');
  return createHash('sha256').update(secret).digest();
}

export function encryptTaxIdentifier(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [CIPHER_VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptTaxIdentifier(value: string): string {
  const [version, ivValue, tagValue, encryptedValue] = value.split('.');
  if (version !== CIPHER_VERSION || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('Protected tax identifier could not be read');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function maskTaxIdentifier(value: string): string {
  const visible = value.slice(-4);
  return `•••• ${visible}`;
}