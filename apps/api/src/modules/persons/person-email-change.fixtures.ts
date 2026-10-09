import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { vi } from 'vitest';
import {
  mockSupabase as seededSupabase,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { PersonEmailChangeService } from './person-email-change.service';

/** The seeded tables and the service of the email-change link's tests. */
const hashed = (token: string) => createHash('sha256').update(token).digest('hex');

export const MARC = {
  id: 'request-marc',
  token_hash: hashed('marc-token'),
  user_id: 'user-marc',
  old_email: 'marc@old.fr',
  new_email: 'marc@new.fr',
  expires_at: '2099-01-01T00:00:00.000Z',
  confirmed_at: null,
  cancelled_at: null,
};
// Another account's request, seeded FIRST: a read that names no token would confirm it.
const BOB = { ...MARC, id: 'request-bob', token_hash: hashed('bob-token'), user_id: 'user-bob' };

export const requests = (marc: object): Record<string, TableSeed> => ({
  person_email_change_requests: { rows: [BOB, { ...MARC, ...marc }] },
  persons: { rows: [] },
  audit_log: { data: null, error: null },
});

export function build(tables: Record<string, TableSeed> = requests({})) {
  const db = seededSupabase(tables);
  const updateUserById = vi.fn().mockResolvedValue({ data: { user: {} }, error: null });
  // The auth server's list of the accounts whose address holds the one asked: nobody.
  const listAuthAdminUsers = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, data: { users: [] } });
  const supabase = {
    service: { from: db.service.from, auth: { admin: { updateUserById } } },
    listAuthAdminUsers,
  };
  const config = {
    get: vi.fn((key: string, def?: string) => (key === 'DOMAIN' ? 'myclash.localhost' : def)),
  };
  const service = new PersonEmailChangeService(supabase as never, {} as never, config as never);
  const warned = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const failed = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  return { service, db, updateUserById, listAuthAdminUsers, warned, failed };
}

/** The limit of a call, run out by hand: `runOut()` ends the wait of the newest call. */
export function limitByHand() {
  const limits: number[] = [];
  const clocks: AbortController[] = [];
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    limits.push(ms);
    clocks.push(new AbortController());
    return clocks.at(-1)!.signal;
  });
  return { limits, runOut: () => clocks.at(-1)!.abort() };
}

/** An answer of the auth server that comes when the test says so. */
export function heldAnswer() {
  let answer: (value: unknown) => void = () => undefined;
  const asked = new Promise<unknown>((resolve) => {
    answer = resolve;
  });
  return { asked, answer };
}
