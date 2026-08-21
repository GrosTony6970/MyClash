import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';

/**
 * `createAccount` — the last write on the staff-admin surface with no test.
 *
 * `staff.service.admin.test.ts` covered `listAccounts`, `updateAccount`,
 * `resetPin` and `setLices` and stopped there, so the create path was executed
 * by nothing in the API suite. What that hid: every PostgREST error came back
 * as a 400 carrying the database's own sentence, so an organiser reusing a
 * username read `duplicate key value violates unique constraint
 * "idx_event_staff_accounts_event_username"` and the browser had no code to
 * branch on.
 *
 * The seed for `event_staff_accounts` is a QUEUE rather than a simulated table,
 * because this path asks the same table two different questions: the insert
 * (which must fail) and the status lookup behind the refusal (which must find a
 * row). A `{ rows }` seed answers both from one set and cannot express that.
 * The order is the call order and is asserted by the tests below reading back
 * what the second call projected.
 */

const ORG = 'org-1';
const EVENT = 'event-1';
const USER = 'user-1';

const eventRow = {
  id: EVENT,
  organization_id: ORG,
  slug: 'slug-event-1',
  name: 'Event 1',
  status: 'running',
  start_date: '2026-08-08',
  end_date: '2099-12-31',
};

const DUPLICATE = {
  code: '23505',
  message:
    'duplicate key value violates unique constraint "idx_event_staff_accounts_event_username"',
};

const DTO = { displayName: 'Marie Dubois', username: 'Marie ', pin: '481937' };

/**
 * `staffAccounts` is the queue answering `event_staff_accounts`, in call order:
 * the insert first, then the status lookup.
 */
function build(
  staffAccounts: Array<{ data?: unknown; error?: { message: string; code?: string } }>,
) {
  const supabase = mockSupabase({
    events: { rows: [eventRow] },
    event_staff_accounts: staffAccounts,
  });
  const service = new StaffService(
    supabase as never,
    { assertOrgRole: vi.fn(async () => {}) } as never,
    {} as never,
    {} as never,
  );
  return { service, supabase };
}

describe('StaffService.createAccount', () => {
  it('answers a conflict, not a bad request, when the username is taken', async () => {
    const { service } = build([{ error: DUPLICATE }, { data: { status: 'active' } }]);

    const error = await service.createAccount(EVENT, DTO as never, USER).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error).not.toBeInstanceOf(BadRequestException);
    expect((error as ConflictException).getStatus()).toBe(409);
  });

  it('names the collision in a code the browser can match, and drops the index name', async () => {
    const { service } = build([{ error: DUPLICATE }, { data: { status: 'active' } }]);

    const error = (await service
      .createAccount(EVENT, DTO as never, USER)
      .catch((e: unknown) => e)) as ConflictException;
    const body = error.getResponse() as Record<string, unknown>;

    expect(body['code']).toBe('staff_username_taken');
    expect(body['existingStatus']).toBe('active');
    // The whole point of the branch: the constraint name is internal schema and
    // was reaching the organiser's browser verbatim.
    expect(JSON.stringify(body)).not.toContain('idx_event_staff_accounts_event_username');
  });

  it('reports a disabled holder as disabled, so the organiser re-enables instead of renaming', async () => {
    // The unique index is NOT partial, so a deactivated volunteer keeps their
    // username and collides with a row the active roster never shows.
    const { service } = build([{ error: DUPLICATE }, { data: { status: 'disabled' } }]);

    const error = (await service
      .createAccount(EVENT, DTO as never, USER)
      .catch((e: unknown) => e)) as ConflictException;

    expect((error.getResponse() as Record<string, unknown>)['existingStatus']).toBe('disabled');
  });

  it('looks the holder up on this event only, and reads the status column', async () => {
    const { service, supabase } = build([{ error: DUPLICATE }, { data: { status: 'active' } }]);

    await service.createAccount(EVENT, DTO as never, USER).catch(() => undefined);

    // The double ignores the projection, so asserting the value alone stays
    // green with `status` deleted from the select.
    expect(selectsFor(supabase.from, 'event_staff_accounts')).toContain('status');
    // Scoped to the event, and to the username as it is STORED — normalised.
    // `Marie ` in the DTO is written as `marie`, so looking up the raw string
    // would find nothing and lose the status every time.
    const filters = filtersFor(supabase.from, 'event_staff_accounts', 'eq');
    expect(filters).toContainEqual(['event_id', EVENT]);
    expect(filters).toContainEqual(['username', 'marie']);
  });

  it('still refuses when the holder cannot be read, rather than masking the conflict', async () => {
    const { service } = build([{ error: DUPLICATE }, { data: null }]);

    const error = (await service
      .createAccount(EVENT, DTO as never, USER)
      .catch((e: unknown) => e)) as ConflictException;
    const body = error.getResponse() as Record<string, unknown>;

    expect(error).toBeInstanceOf(ConflictException);
    expect(body['code']).toBe('staff_username_taken');
    expect(body).not.toHaveProperty('existingStatus');
  });

  it('leaves every other write failure alone', async () => {
    const { service } = build([
      { error: { code: 'PGRST204', message: "Could not find the 'role' column" } },
    ]);

    const error = await service.createAccount(EVENT, DTO as never, USER).catch((e: unknown) => e);

    // Not a conflict: a schema-cache miss is not a name someone else took, and
    // reporting it as one would send the organiser hunting for a duplicate.
    expect(error).toBeInstanceOf(BadRequestException);
  });
});
