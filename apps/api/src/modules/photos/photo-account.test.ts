import { describe, expect, it, vi } from 'vitest';
import { HttpException, Logger } from '@nestjs/common';
import type { SupabaseService } from '../supabase/supabase.service';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { accountPhotoName } from './photo-account';

const UID = 'uid-1';
type AuthAnswer = { data: { user: unknown } | null; error: { message: string } | null };

/** The profile table and the auth server's account read, as the name reader meets them. */
function reader(profile: TableSeed, account: AuthAnswer | Error) {
  const db = mockSupabase({ global_persons: profile });
  const getUserById = vi.fn(() =>
    account instanceof Error ? Promise.reject(account) : Promise.resolve(account),
  );
  const supabase = { service: { ...db.service, auth: { admin: { getUserById } } } };
  return {
    from: db.from,
    getUserById,
    name: () => accountPhotoName(supabase as unknown as SupabaseService, UID),
  };
}

const signedUp = (metadata: Record<string, unknown>, email = 'lea@example.test'): AuthAnswer => ({
  data: { user: { id: UID, email, user_metadata: metadata } },
  error: null,
});
const profileOf = (name: string | null) => ({
  data: name === null ? null : { display_name: name },
});

async function refusal(promise: Promise<unknown>): Promise<{ status: number; code: unknown }> {
  const error = await promise.then(
    () => null,
    (fault: unknown) => fault,
  );
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  return { status: http.getStatus(), code: (http.getResponse() as { code?: unknown }).code };
}

describe('accountPhotoName (ruling 458)', () => {
  it('the profile name wins', async () => {
    const r = reader(profileOf('  Léa Martin '), signedUp({ display_name: 'lea_m' }));
    expect(await r.name()).toBe('Léa Martin');
    expect(r.getUserById).not.toHaveBeenCalled();
    expect(selectsFor(r.from, 'global_persons')).toEqual(['display_name']);
    expect(filtersFor(r.from, 'global_persons', 'eq')).toEqual([['claimed_by_user_id', UID]]);
  });

  it('the sign-up name when there is no profile', async () => {
    const r = reader(profileOf(null), signedUp({ display_name: 'lea_m' }));
    expect(await r.name()).toBe('lea_m');
    expect(r.getUserById).toHaveBeenCalledWith(UID);
  });

  it('a blank profile name falls through to the sign-up name', async () => {
    const r = reader(profileOf('   '), signedUp({ display_name: ' lea_m ' }));
    expect(await r.name()).toBe('lea_m');
  });

  it('never the email', async () => {
    const r = reader(profileOf(null), signedUp({}));
    expect(await r.name()).toBeNull();
  });

  it('a sign-up name that is not text is no name', async () => {
    const r = reader(profileOf(null), signedUp({ display_name: 42 }));
    expect(await r.name()).toBeNull();
  });

  it('a name past 200 is cut at 200 characters, not bytes', async () => {
    const r = reader(profileOf('é'.repeat(201)), signedUp({}));
    expect(await r.name()).toBe('é'.repeat(200));
  });

  // Each 503 leaves its cause in the log: "Photos are unavailable" alone names no read.
  it('a failed profile read is unavailable, not nameless, and says why', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const r = reader({ data: null, error: { message: 'boom' } }, signedUp({ display_name: 'x' }));
    expect(await refusal(r.name())).toEqual({ status: 503, code: 'photos_unavailable' });
    expect(String(warn.mock.calls.at(-1)?.[0])).toContain('profile not read: boom');
  });

  it('the auth server failing is unavailable, not nameless, and says why', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const r = reader(profileOf(null), { data: null, error: { message: 'down' } });
    expect(await refusal(r.name())).toEqual({ status: 503, code: 'photos_unavailable' });
    expect(String(warn.mock.calls.at(-1)?.[0])).toContain('account not read: down');
  });

  it('the auth server not answering is unavailable, not nameless, and says why', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const r = reader(profileOf(null), new Error('socket hang up'));
    expect(await refusal(r.name())).toEqual({ status: 503, code: 'photos_unavailable' });
    expect(String(warn.mock.calls.at(-1)?.[0])).toContain('account not read: socket hang up');
  });
});
