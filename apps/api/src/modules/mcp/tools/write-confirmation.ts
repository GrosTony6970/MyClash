import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { McpCaller } from '../mcp-server';

/** A preview's confirmation stays good for ten minutes. */
export const CONFIRMATION_TTL_MS = 10 * 60 * 1000;

const IV_BYTES = 12;
const TAG_BYTES = 16;

const payloadSchema = z
  .object({
    v: z.literal(1),
    sub: z.string(),
    cid: z.string(),
    matchId: z.string(),
    role: z.string(),
    /** null = remove the holder. */
    personId: z.string().nullable(),
    /** Who held the role at preview time. */
    prev: z.string().nullable(),
    /** The Discouraged reason codes the preview showed, sorted. */
    codes: z.array(z.string()),
    /** Epoch ms. */
    exp: z.number(),
  })
  .strict();

export type ConfirmationPayload = z.infer<typeof payloadSchema>;

/** The 32-byte key for sealing, derived once from the server secret. */
export function confirmationKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'myclash/mcp/confirm/v1', 32));
}

/** Seals a payload (the caller supplies all but `v` and `exp`) into one opaque token. */
export function sealConfirmation(
  key: Buffer,
  payload: Omit<ConfirmationPayload, 'v' | 'exp'>,
  now: number,
): { token: string; expiresAt: string } {
  const exp = now + CONFIRMATION_TTL_MS;
  const body = Buffer.from(JSON.stringify({ ...payload, v: 1, exp }), 'utf8');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(body), cipher.final()]);
  const token = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  return { token, expiresAt: new Date(exp).toISOString() };
}

/** The payload, or null for anything wrong with the token. Never throws on input. */
export function openConfirmation(
  key: Buffer,
  token: unknown,
  caller: McpCaller,
  now: number,
): ConfirmationPayload | null {
  if (typeof token !== 'string') return null;
  const raw = Buffer.from(token, 'base64url');
  if (raw.length <= IV_BYTES + TAG_BYTES) return null;
  let plain: string;
  try {
    // The tag length pinned: unpinned, `setAuthTag` takes a shorter tag. The slice below always
    // gives 16 bytes, so this is defence in depth.
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    plain = Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(plain);
  } catch {
    return null;
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) return null;
  const p = parsed.data;
  if (now >= p.exp) return null;
  if (p.sub !== caller.userId || p.cid !== caller.clientId) return null;
  return p;
}
