import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Connector credential encryption (Phase O3a). A pull source's auth-header VALUE must be sent
 * upstream at fetch time, so it is stored ENCRYPTED (reversible), not hashed. AES-256-GCM with a
 * key derived from CONNECTOR_SECRET; the plaintext is never persisted or returned in any response.
 * Ciphertext format: `v1:<iv b64>:<tag b64>:<data b64>`.
 */
function key(): Buffer {
  const secret = process.env['CONNECTOR_SECRET'];
  if (secret === undefined || secret.length === 0) {
    throw new Error('CONNECTOR_SECRET is required to store/use connector credentials');
  }
  return scryptSync(secret, 'provable-connector-v1', 32);
}

export function encryptionAvailable(): boolean {
  const s = process.env['CONNECTOR_SECRET'];
  return s !== undefined && s.length > 0;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

export function decryptSecret(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('malformed connector ciphertext');
  const [, ivb, tagb, datab] = parts as [string, string, string, string];
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivb, 'base64'));
  decipher.setAuthTag(Buffer.from(tagb, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(datab, 'base64')), decipher.final()]).toString('utf8');
}
