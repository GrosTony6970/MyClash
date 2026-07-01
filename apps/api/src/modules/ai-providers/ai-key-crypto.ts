import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * AES-256-GCM helpers for AI provider keys at rest. Shared by every scope
 * (platform / organization / fighter) so the encryption format stays identical
 * — ciphertext is `base64(encrypted || authTag)`, iv is base64. The secret is
 * `AI_KEY_SECRET` (64-char hex → 32 bytes).
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function loadAiKeySecret(): Buffer {
  const secret = process.env['AI_KEY_SECRET'];
  if (!secret) throw new Error('AI_KEY_SECRET env var is required');
  const key = Buffer.from(secret, 'hex');
  if (key.length !== 32) {
    throw new Error('AI_KEY_SECRET must be a 64-character hex string (32 bytes)');
  }
  return key;
}

export function encryptAiKey(secret: Buffer, rawKey: string): { ciphertext: string; iv: string } {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, secret, iv);
  const encrypted = Buffer.concat([cipher.update(rawKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([encrypted, tag]).toString('base64'),
    iv: iv.toString('base64'),
  };
}

export function decryptAiKey(secret: Buffer, ciphertext: string, ivBase64: string): string {
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = Buffer.from(ivBase64, 'base64');
  const encrypted = buf.subarray(0, buf.length - TAG_LENGTH);
  const tag = buf.subarray(buf.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, secret, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
