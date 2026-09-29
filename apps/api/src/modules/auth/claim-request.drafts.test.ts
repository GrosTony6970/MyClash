/**
 * `POST /me/global-person-claim` (ruling 175): a profile known only through entries hidden from
 * the public — a draft Tournament, a draft or test Event — answers EXACTLY like an unknown one,
 * with or without an email or a HEMA Ratings id, and nothing is mailed or written. A profile that
 * stands on its own — claimed by an account, or made outside a roster (a super admin's) — is
 * public whatever its entries (rulings 176, 176a). It spans many Events, so it shows public things
 * only, for everyone (ruling 163): no membership is read.
 */
import 'reflect-metadata';
import type { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  writesTo,
  type SupabaseRow,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { AuthService } from './auth.service';

const profile = (id: string, over: SupabaseRow = {}): SupabaseRow => ({
  id,
  display_name: `Martin ${id}`,
  email: `${id}@example.com`,
  claimed_by_user_id: null,
  made_outside_roster: false,
  ...over,
});
const rosterRow = (id: string, eventId: string, profileId: string) => ({
  id,
  event_id: eventId,
  global_person_id: profileId,
});
const entry = (personId: string, tournamentId: string) => ({
  person_id: personId,
  tournament_id: tournamentId,
  status: 'registered',
});

const PROFILES = [
  profile('open'),
  profile('draft-only'),
  profile('draft-claimed', { claimed_by_user_id: 'someone' }),
  profile('draft-no-email', { email: null }),
  // Made by her draft entry, which carried her HEMA Ratings id (ruling 176a).
  profile('draft-rated', { hema_ratings_id: '4242' }),
  // Made by a super admin, before any entry.
  profile('draft-imported', { made_outside_roster: true }),
  profile('no-roster'),
];
// One roster row each but `no-roster`'s: `open` is entered in the public Tournament, the rest
// only in the draft one.
const ROSTERED = PROFILES.map((p) => p['id'] as string).filter((id) => id !== 'no-roster');

type Tables = Record<string, TableSeed>;
function baseTables(): Tables {
  return {
    global_persons: { rows: PROFILES },
    events: {
      rows: [
        { id: 'e-pub', status: 'published', organization_id: 'org-a', event_kind: 'standard' },
      ],
    },
    tournaments: {
      rows: [
        { id: 't-open', event_id: 'e-pub', status: 'published' },
        { id: 't-secret', event_id: 'e-pub', status: 'draft' },
      ],
    },
    persons: { rows: ROSTERED.map((id) => rosterRow(`p-${id}`, 'e-pub', id)) },
    registrations: {
      rows: ROSTERED.map((id) => entry(`p-${id}`, id === 'open' ? 't-open' : 't-secret')),
    },
    event_referees: { rows: [] },
    event_instructors: { rows: [] },
    global_person_claim_tokens: { rows: [] },
    global_person_claim_requests: { rows: [] },
    // The caller runs the draft's club: the claim still shows public things only (ruling 163).
    organization_members: { rows: [{ organization_id: 'org-a', user_id: 'u-1', role: 'owner' }] },
  };
}

let db: ReturnType<typeof mockSupabase>;
let mail: { sendMagicLink: ReturnType<typeof vi.fn> };

function request(id: string) {
  const supabase = { service: db.service, getAuthUser: vi.fn(async () => ({ id: 'u-1' })) };
  const service = new AuthService(
    supabase as never,
    mail as never,
    { getOrThrow: vi.fn(), get: vi.fn((_k: string, def?: string) => def ?? '') } as never,
    {} as never,
    {} as never,
    new OrganizationsService(supabase as never),
  );
  const req = { headers: { authorization: 'Bearer t' }, cookies: {} };
  return service.requestGlobalPersonClaim(req as never, id);
}

const refusal = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (err: unknown) => err,
  );
const shapeOf = (err: unknown) => {
  expect(err, 'expected a refusal, the call succeeded').not.toBeNull();
  const http = err as HttpException;
  return { type: http.constructor.name, status: http.getStatus(), body: http.getResponse() };
};

beforeEach(() => {
  db = mockSupabase(baseTables());
  mail = { sendMagicLink: vi.fn().mockResolvedValue(undefined) };
});

describe('the claim request answers a profile known only through hidden entries as unknown (ruling 175)', () => {
  it.each(['draft-only', 'draft-no-email', 'draft-rated'])(
    'answers %s exactly like an unknown profile, and mails and writes nothing',
    async (id) => {
      const unknown = shapeOf(await refusal(request('nobody')));
      expect(shapeOf(await refusal(request(id)))).toEqual(unknown);
      expect(unknown).toMatchObject({ status: 404 });
      expect(mail.sendMagicLink).not.toHaveBeenCalled();
      expect(writesTo(db, 'global_person_claim_tokens')).toEqual([]);
      expect(writesTo(db, 'global_person_claim_requests')).toEqual([]);
      // Public things only: nobody's membership is asked.
      expect(queriedTables(db.from)).not.toContain('organization_members');
    },
  );

  it('still mails the link for a profile with a public entry, or with no roster row', async () => {
    await expect(request('open')).resolves.toMatchObject({ status: 'confirmation_sent' });
    await expect(request('no-roster')).resolves.toMatchObject({ status: 'confirmation_sent' });
    expect(mail.sendMagicLink.mock.calls.map((call) => call[0].to)).toEqual([
      'open@example.com',
      'no-roster@example.com',
    ]);
  });

  it('5xxs when the roster rows cannot be read, and mails nothing', async () => {
    db = mockSupabase({ ...baseTables(), persons: { data: null, error: { message: 'boom' } } });
    const failure = await refusal(request('open'));
    expect(failure).toBeInstanceOf(Error);
    expect((failure as { getStatus?: unknown }).getStatus).toBeUndefined();
    expect(String(failure)).toContain('profile roster read failed: boom');
    expect(mail.sendMagicLink).not.toHaveBeenCalled();
  });
});

describe('a profile that stands on its own stays public whatever its entries (rulings 176, 176a)', () => {
  it('answers a claimed draft-only profile "already claimed", as any claimed profile', async () => {
    expect(shapeOf(await refusal(request('draft-claimed')))).toMatchObject({
      status: 400,
      body: { code: 'already_claimed' },
    });
    expect(mail.sendMagicLink).not.toHaveBeenCalled();
  });

  it("mails the link for a super admin's profile entered only in a draft, reading no roster row", async () => {
    await expect(request('draft-imported')).resolves.toMatchObject({
      status: 'confirmation_sent',
    });
    expect(mail.sendMagicLink.mock.calls.map((call) => call[0].to)).toEqual([
      'draft-imported@example.com',
    ]);
    expect(queriedTables(db.from)).not.toContain('persons');
  });

  it('asks which of the profiles an account owns or a super admin made', async () => {
    await refusal(request('draft-only'));
    expect(selectsFor(db.from, 'global_persons')[1]).toBe('id');
    expect(filtersFor(db.from, 'global_persons', 'in')).toEqual([['id', ['draft-only']]]);
    expect(filtersFor(db.from, 'global_persons', 'or')).toEqual([
      ['claimed_by_user_id.not.is.null,made_outside_roster.is.true'],
    ]);
  });

  it('5xxs when the profiles cannot be read, and mails nothing', async () => {
    db = mockSupabase({
      ...baseTables(),
      global_persons: [
        { data: profile('open'), error: null },
        { data: null, error: { message: 'boom' } },
      ],
    });
    const failure = await refusal(request('open'));
    expect(failure).toBeInstanceOf(Error);
    expect((failure as { getStatus?: unknown }).getStatus).toBeUndefined();
    expect(String(failure)).toContain('profile read failed: boom');
    expect(mail.sendMagicLink).not.toHaveBeenCalled();
  });
});
