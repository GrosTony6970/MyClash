import { HttpException, UnauthorizedException } from '@nestjs/common';
import { SIGNUPS_DISABLED_CODE, WRONG_CURRENT_PASSWORD_CODE } from '@myclash/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';
import { OperationalUnavailableException } from '../../common/operational-exception';
import {
  mockSupabase as seededSupabase,
  type TableSeed,
} from '../../common/testing/supabase-chain';

/**
 * The participant app's password door when the auth server does not judge the password.
 *
 * Lea is a Fighter. She types the right password while the auth server is down or throttled.
 * The door answered its 401 for every failure of its call, so the login page told her "Wrong
 * email or password", and the security page "Current password is incorrect" before a password
 * change or an account deletion. A silent, throttled or failing auth server is a server error
 * now, as at the admin door (operator ruling 309); the 401 is for a refused password only.
 */
const LEA = { id: 'user-lea', email: 'lea@example.com', identities: [{ provider: 'email' }] };

const config = {
  getOrThrow: vi.fn(() => 'http://supabase-auth:9999'),
  get: vi.fn((key: string, def?: string) => (key === 'DOMAIN' ? 'myclash.localhost' : (def ?? ''))),
};

function build(tables: Record<string, TableSeed> = {}) {
  const db = seededSupabase(tables);
  const updateUserById = vi.fn().mockResolvedValue({ error: null });
  const deleteUser = vi.fn().mockResolvedValue({ error: null });
  const redactSubject = vi.fn();
  const supabase = {
    getAuthUser: vi.fn().mockResolvedValue(LEA),
    service: { from: db.service.from, auth: { admin: { updateUserById, deleteUser } } },
  };
  const service = new AuthService(
    supabase as never,
    { sendMagicLink: vi.fn() } as never,
    config as never,
    { redactSubject } as never,
    { assertCurrent: vi.fn(() => ({})) } as unknown as LegalAcceptanceService,
    {} as never,
  );
  const reply = { setCookie: vi.fn(), clearCookie: vi.fn(), send: vi.fn() };
  const signedIn = { headers: { authorization: 'Bearer access' } } as never;
  const doors = {
    login: () => service.publicLogin(LEA.email, 'right-password', reply as never),
    changePassword: () =>
      service.changePassword(signedIn, 'right-password', 'A-much-Longer-passw0rd!'),
    deleteAccount: () =>
      service.deleteAccount(signedIn, 'right-password', 'DELETE', reply as never),
  };
  return { service, supabase, doors, reply, updateUserById, deleteUser, redactSubject };
}

type Door = 'login' | 'changePassword' | 'deleteAccount';
const DOORS: Door[] = ['login', 'changePassword', 'deleteAccount'];

const answers = (status: number, body: object = { error: 'x' }) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, json: async () => body }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(DOORS)('the participant password door, %s', (door) => {
  it.each([429, 500, 502, 503])(
    'fails with a plain error when the auth server answers %s',
    async (status) => {
      answers(status);
      const built = build();

      const failure = await built.doors[door]().catch((err: unknown) => err);

      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(HttpException);
      expect((failure as Error).message).toContain(String(status));
      expect(built.reply.setCookie).not.toHaveBeenCalled();
      expect(built.updateUserById).not.toHaveBeenCalled();
      expect(built.redactSubject).not.toHaveBeenCalled();
      expect(built.deleteUser).not.toHaveBeenCalled();
    },
  );

  it('fails with a plain error when the auth server does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')));
    const built = build();

    const failure = await built.doors[door]().catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect((failure as Error).message).toContain('ECONNREFUSED');
    expect(built.redactSubject).not.toHaveBeenCalled();
  });
});

describe('the participant sign-in', () => {
  it('answers a 401 when the auth server refuses the password', async () => {
    answers(400, { error_code: 'invalid_credentials' });

    await expect(build().doors.login()).rejects.toThrow(UnauthorizedException);
  });
});

/**
 * The current password, asked again by a signed-in account (operator ruling 329).
 *
 * Marie leaves her security page open and her login runs out. She types the right current
 * password, and the page said "Current password is incorrect": these two doors answered 401
 * for a wrong password AND for an ended session. A wrong current password is a 403 with its
 * own code now. The 401 is the ended session's alone, which the page renews once.
 */
describe.each<Door>(['changePassword', 'deleteAccount'])('the current password at %s', (door) => {
  const wrongCurrentPassword = {
    code: WRONG_CURRENT_PASSWORD_CODE,
    message: 'Current password is incorrect',
  };

  it('answers the coded 403 when the auth server refuses the password', async () => {
    answers(400, { error_code: 'invalid_credentials' });
    const built = build();

    const refusal = await built.doors[door]().catch((err: unknown) => err);

    expect((refusal as HttpException).getStatus()).toBe(403);
    expect((refusal as HttpException).getResponse()).toEqual(wrongCurrentPassword);
    expect(built.updateUserById).not.toHaveBeenCalled();
    expect(built.redactSubject).not.toHaveBeenCalled();
    expect(built.deleteUser).not.toHaveBeenCalled();
  });

  it('answers the coded 403 when the password opens another account', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'access', user: { id: 'user-other' } }),
      }),
    );
    const built = build();

    const refusal = await built.doors[door]().catch((err: unknown) => err);

    expect((refusal as HttpException).getStatus()).toBe(403);
    expect((refusal as HttpException).getResponse()).toEqual(wrongCurrentPassword);
    expect(built.updateUserById).not.toHaveBeenCalled();
    expect(built.redactSubject).not.toHaveBeenCalled();
  });

  it('answers a 401 for a session that has ended, and asks no password', async () => {
    const fetched = vi.fn();
    vi.stubGlobal('fetch', fetched);
    const built = build();
    built.supabase.getAuthUser.mockResolvedValue(null);

    await expect(built.doors[door]()).rejects.toThrow(UnauthorizedException);
    expect(fetched).not.toHaveBeenCalled();
  });
});

describe('the participant sign-in', () => {
  it('still answers the coded 403 for an address that is not confirmed', async () => {
    answers(400, { error_code: 'email_not_confirmed' });

    const refusal = await build()
      .doors.login()
      .catch((err: unknown) => err);

    expect((refusal as HttpException).getStatus()).toBe(403);
    expect((refusal as HttpException).getResponse()).toEqual({
      code: 'email_not_confirmed',
      message: 'Email not confirmed',
    });
  });

  it('signs her in when the auth server takes the password', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'access', refresh_token: 'refresh', user: LEA }),
      }),
    );
    const built = build({ global_persons: { rows: [] }, persons: { rows: [] } });
    vi.spyOn(built.service, 'tryAutolinkGlobalPerson').mockResolvedValue(undefined);

    await built.doors.login();

    expect(built.reply.send).toHaveBeenCalledWith({ next: '/me' });
  });
});

/**
 * "Sign-ups are off" is told by its code.
 *
 * The door threw a plain 503. The API replaces the code and the words of every plain 5xx, so
 * the participant app could only read "any 503" as "sign-ups are off": a 503 of the edge,
 * while the API is down, read the same. The refusal keeps its code now.
 */
describe('the participant sign-up while sign-ups are switched off', () => {
  it('refuses with the coded 503 that keeps its code through the error filter', async () => {
    const { service } = build({
      feature_flags: { rows: [{ key: 'disable_public_signups', enabled: true }] },
    });

    const refusal = await service
      .publicSignup(LEA.email, 'A-much-Longer-passw0rd!', {})
      .catch((err: unknown) => err);

    expect(refusal).toBeInstanceOf(OperationalUnavailableException);
    expect((refusal as HttpException).getStatus()).toBe(503);
    expect((refusal as HttpException).getResponse()).toMatchObject({ code: SIGNUPS_DISABLED_CODE });
  });
});
