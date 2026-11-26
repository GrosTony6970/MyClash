import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { McpCaller } from '../mcp-server';
import { expectNoRawIds } from './no-raw-ids.test-helper';
import {
  CONFIRMATION_TTL_MS,
  confirmationKey,
  openConfirmation,
  sealConfirmation,
} from './write-confirmation';

// The real ciphers, watched: the tag-length pin is seen only in the call's options.
vi.mock('node:crypto', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:crypto')>();
  return {
    ...real,
    createCipheriv: vi.fn(real.createCipheriv),
    createDecipheriv: vi.fn(real.createDecipheriv),
  };
});

const key = confirmationKey('secret-one');
const NOW = 1_800_000_000_000;
const caller: McpCaller = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: null,
  clientId: '22222222-2222-4222-8222-222222222222',
};
const payload = {
  sub: caller.userId,
  cid: caller.clientId,
  matchId: '33333333-3333-4333-8333-333333333333',
  role: 'referee',
  personId: '44444444-4444-4444-8444-444444444444' as string | null,
  prev: '55555555-5555-4555-8555-555555555555' as string | null,
  codes: ['a', 'b'],
};

/** Seals an arbitrary plaintext with the real key, to reach the shape checks. */
function sealRaw(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}

describe('write confirmation', () => {
  it('round-trips the payload and sets v and exp', () => {
    const { token, expiresAt } = sealConfirmation(key, payload, NOW);
    expect(expiresAt).toBe(new Date(NOW + CONFIRMATION_TTL_MS).toISOString());
    expect(openConfirmation(key, token, caller, NOW + 1)).toEqual({
      ...payload,
      v: 1,
      exp: NOW + CONFIRMATION_TTL_MS,
    });
  });

  it('round-trips a removal (personId null, prev null)', () => {
    const { token } = sealConfirmation(key, { ...payload, personId: null, prev: null }, NOW);
    const opened = openConfirmation(key, token, caller, NOW);
    expect(opened?.personId).toBeNull();
    expect(opened?.prev).toBeNull();
  });

  it('refuses a token that is not a string', () => {
    expect(openConfirmation(key, 42, caller, NOW)).toBeNull();
    expect(openConfirmation(key, undefined, caller, NOW)).toBeNull();
  });

  it('refuses bad base64 and a too-short token', () => {
    expect(openConfirmation(key, '!!!not base64!!!', caller, NOW)).toBeNull();
    expect(openConfirmation(key, 'abc', caller, NOW)).toBeNull();
    expect(openConfirmation(key, '', caller, NOW)).toBeNull();
  });

  it('refuses a token with one byte changed', () => {
    const { token } = sealConfirmation(key, payload, NOW);
    const raw = Buffer.from(token, 'base64url');
    for (const i of [0, 12, 28, raw.length - 1]) {
      const bad = Buffer.from(raw);
      bad[i] = bad[i]! ^ 1;
      expect(openConfirmation(key, bad.toString('base64url'), caller, NOW)).toBeNull();
    }
  });

  it('refuses a token sealed with another key', () => {
    const { token } = sealConfirmation(confirmationKey('secret-two'), payload, NOW);
    expect(openConfirmation(key, token, caller, NOW)).toBeNull();
  });

  it('refuses a payload of the wrong shape', () => {
    expect(openConfirmation(key, sealRaw('not json'), caller, NOW)).toBeNull();
    expect(openConfirmation(key, sealRaw('{"v":1}'), caller, NOW)).toBeNull();
  });

  it('refuses a payload with a key it does not know', () => {
    const extra = { ...payload, admin: true } as typeof payload;
    const { token } = sealConfirmation(key, extra, NOW);
    expect(openConfirmation(key, token, caller, NOW)).toBeNull();
  });

  it('refuses a payload with a field of the wrong type', () => {
    const good = { ...payload, v: 1, exp: NOW + 1000 };
    expect(openConfirmation(key, sealRaw(JSON.stringify(good)), caller, NOW)).not.toBeNull();
    for (const bad of [{ codes: 'own_pool' }, { exp: String(NOW + 1000) }]) {
      const body = JSON.stringify({ ...good, ...bad });
      expect(openConfirmation(key, sealRaw(body), caller, NOW)).toBeNull();
    }
  });

  it('pins the 16-byte tag on both ciphers', () => {
    // The token's tag is sliced at a fixed 16 bytes, so no token can hand `setAuthTag` a
    // shorter one: the pin is defence in depth, and only the options show it.
    vi.mocked(createCipheriv).mockClear();
    vi.mocked(createDecipheriv).mockClear();
    const { token } = sealConfirmation(key, payload, NOW);
    expect(openConfirmation(key, token, caller, NOW)).not.toBeNull();
    const pin = { authTagLength: 16 };
    expect(vi.mocked(createCipheriv).mock.calls[0]?.[3]).toEqual(pin);
    expect(vi.mocked(createDecipheriv).mock.calls[0]?.[3]).toEqual(pin);
  });

  it('refuses another version', () => {
    const body = JSON.stringify({ ...payload, v: 2, exp: NOW + 1000 });
    expect(openConfirmation(key, sealRaw(body), caller, NOW)).toBeNull();
  });

  it('refuses an expired token, at the instant and after', () => {
    const { token } = sealConfirmation(key, payload, NOW);
    expect(openConfirmation(key, token, caller, NOW + CONFIRMATION_TTL_MS - 1)).not.toBeNull();
    expect(openConfirmation(key, token, caller, NOW + CONFIRMATION_TTL_MS)).toBeNull();
    expect(openConfirmation(key, token, caller, NOW + CONFIRMATION_TTL_MS + 1)).toBeNull();
  });

  it('refuses another user', () => {
    const { token } = sealConfirmation(key, payload, NOW);
    expect(openConfirmation(key, token, { ...caller, userId: 'someone-else' }, NOW)).toBeNull();
  });

  it('refuses another client', () => {
    const { token } = sealConfirmation(key, payload, NOW);
    expect(openConfirmation(key, token, { ...caller, clientId: 'another-client' }, NOW)).toBeNull();
  });

  it('shows no UUID in the token', () => {
    const { token } = sealConfirmation(key, payload, NOW);
    expectNoRawIds({ token });
  });

  it('derives one key per secret', () => {
    expect(confirmationKey('s').equals(confirmationKey('s'))).toBe(true);
    expect(confirmationKey('s').equals(confirmationKey('t'))).toBe(false);
    expect(confirmationKey('s')).toHaveLength(32);
  });
});
