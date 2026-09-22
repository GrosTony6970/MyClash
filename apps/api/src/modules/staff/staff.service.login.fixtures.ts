// Seeded rows and builders for the staff sign-in tests, split out when
// staff.service.login.test.ts reached the 400-line cap. It imports vitest, so it
// is named in tsconfig.build.json's exclude list.
//
// Two test files share it: staff.service.login.test.ts (the flow and its
// payload) and staff.service.login.username.test.ts (ruling 48, the exact
// username compare).

import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { vi } from 'vitest';
import { StaffService } from './staff.service';
import { mockSupabase } from '../../common/testing/supabase-chain';

const scrypt = promisify(scryptCallback);

export const ORG = 'org-1';
export const EVENT = 'event-1';
export const OTHER_EVENT = 'event-2';
export const ACCOUNT = 'staff-1';
export const OTHER_ACCOUNT = 'staff-2';
export const LICE = 'lice-1';
export const OTHER_LICE = 'lice-2';

export const PIN = '246810';

/** The stored format `verifyPin` expects: `scrypt:<salt b64>:<key b64>`. */
export async function pinHash(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(pin, salt, 32)) as Buffer;
  return `scrypt:${salt.toString('base64')}:${key.toString('base64')}`;
}

export const eventRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  organization_id: ORG,
  slug: `slug-${id}`,
  name: `Event ${id}`,
  status: 'running',
  start_date: '2026-08-08',
  end_date: '2099-12-31',
  ...over,
});

export const accountRow = (hash: string, over: Record<string, unknown> = {}) => ({
  id: ACCOUNT,
  event_id: EVENT,
  display_name: 'Marie Dubois',
  username: 'marie',
  pin_hash: hash,
  status: 'active',
  role: 'scoring',
  ...over,
});

export const liceRow = (id: string, eventId = EVENT) => ({
  id,
  name: `Piste ${id}`,
  event_id: eventId,
  events: { id: eventId, slug: `slug-${eventId}`, name: `Event ${eventId}`, status: 'running' },
});

export function build(tables: Record<string, unknown>, jwt: Record<string, unknown> = {}) {
  const supabase = mockSupabase(tables as never);
  const sign = vi.fn(() => 'signed-token');
  const service = new StaffService(
    supabase as never,
    {} as never,
    { sign, ...jwt } as never,
    {} as never,
  );
  return { service, supabase, sign };
}

/**
 * An account row carrying the event embed the `me` read-back selects. The
 * double returns whole rows and does not simulate an embed, so a seeded row has
 * to hold its own.
 */
export const withEvent = (account: Record<string, unknown>) => ({
  ...account,
  events: { id: EVENT, slug: `slug-${EVENT}`, name: 'FAL', status: 'running' },
});

/**
 * The three `event_staff_accounts` answers one sign-in consumes, in order: the
 * credential lookup, the last_login_at stamp, then the `me` read-back.
 */
export const signInQueue = (account: Record<string, unknown>) => [
  { data: account, error: null },
  { data: null, error: null },
  { data: withEvent(account), error: null },
];
