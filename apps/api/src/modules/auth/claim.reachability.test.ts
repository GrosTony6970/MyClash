import { createHash } from 'node:crypto';
import type { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockSupabase as seededSupabase,
  selectsFor,
  writesTo,
  type SupabaseRow,
} from '../../common/testing/supabase-chain';
import { REACHABLE_COLUMNS } from '../fighters/directory-predicate';
import { AuthService } from './auth.service';

/**
 * Claiming a profile by id (operator ruling 106): a profile that was erased,
 * deleted or merged away answers EXACTLY like one that does not exist, at the
 * claim request and at the confirmation link. Nothing is mailed and nothing is
 * written.
 *
 * Until 2026-09-25 only a merged profile was refused, and with its own 400: an
 * erased profile kept its email, so a claim mailed a magic link to the erased
 * person and showed the caller a masked copy of the address.
 */
const USER = { id: 'user-1', email: 'paul@example.com', user_metadata: {} };
const ERASED_AT = '2026-09-01T00:00:00Z';

const hashOf = (raw: string) => createHash('sha256').update(raw).digest('hex');
const signedIn = { headers: { authorization: 'Bearer t' }, cookies: {} } as never;

const profile = (id: string, over: SupabaseRow = {}): SupabaseRow => ({
  id,
  display_name: 'Marie Martin',
  email: 'marie@example.com',
  claimed_by_user_id: null,
  ...over,
});

const PROFILES = [
  profile('live'),
  profile('erased', { account_deleted_at: ERASED_AT }),
  profile('merged', { merged_into_id: 'live' }),
  profile('deleted', { deleted_at: ERASED_AT }),
];

let db: ReturnType<typeof seededSupabase>;
let mail: { sendMagicLink: ReturnType<typeof vi.fn> };
let service: AuthService;

function build(tables: Record<string, SupabaseRow[]>) {
  db = seededSupabase(
    Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, { rows }])),
  );
  mail = { sendMagicLink: vi.fn().mockResolvedValue(undefined) };
  service = new AuthService(
    { getAuthUser: vi.fn().mockResolvedValue(USER), service: db } as never,
    mail as never,
    { getOrThrow: vi.fn(), get: vi.fn((_k: string, def?: string) => def ?? '') } as never,
    {} as never,
    {} as never,
  );
}

const refusal = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (err: unknown) => err,
  );

/** Status, class and body: what a caller can tell two refusals apart by. */
const shapeOf = (err: unknown) => {
  expect(err, 'expected a refusal, the call succeeded').not.toBeNull();
  const http = err as HttpException;
  return { type: http.constructor.name, status: http.getStatus(), body: http.getResponse() };
};

describe('POST /me/global-person-claim (ruling 106)', () => {
  beforeEach(() => build({ global_persons: PROFILES, global_person_claim_tokens: [] }));

  const request = (id: string) => service.requestGlobalPersonClaim(signedIn, id);

  it.each(['erased', 'merged', 'deleted'])(
    'answers a %s profile exactly like an unknown one',
    async (id) => {
      const unknown = await refusal(request('nobody'));
      const hidden = await refusal(request(id));
      expect(shapeOf(hidden)).toEqual(shapeOf(unknown));
      expect(shapeOf(unknown)).toMatchObject({ status: 404 });
    },
  );

  it('mails nothing and writes no link for an erased profile', async () => {
    await refusal(request('erased'));
    expect(mail.sendMagicLink).not.toHaveBeenCalled();
    expect(writesTo(db, 'global_person_claim_tokens')).toEqual([]);
    expect(writesTo(db, 'global_person_claim_requests')).toEqual([]);
  });

  it('still mails the link for a live profile', async () => {
    await expect(request('live')).resolves.toMatchObject({ status: 'confirmation_sent' });
    expect(mail.sendMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'marie@example.com', type: 'claim' }),
    );
  });

  it('reads the profile with the columns the claim uses', async () => {
    await request('live');
    expect(selectsFor(db.from, 'global_persons')).toEqual([
      'id, display_name, email, claimed_by_user_id, clubs(name)',
    ]);
  });
});

describe('POST /me/claim-confirm (ruling 106)', () => {
  const TOKEN = 'claim-token-for-marie';
  const tokenRow = (target: SupabaseRow | null, over: SupabaseRow = {}): SupabaseRow => ({
    id: 'token-1',
    user_id: USER.id,
    global_person_id: 'global-1',
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    token_hash: hashOf(TOKEN),
    // The embed the read asks for: the profile's reachability columns.
    global_persons: target,
    ...over,
  });

  const confirm = (raw = TOKEN) => service.confirmGlobalPersonClaim(signedIn, raw);

  it.each([
    ['erased', { account_deleted_at: ERASED_AT }],
    ['merged', { merged_into_id: 'global-2' }],
    ['deleted', { deleted_at: ERASED_AT }],
  ])('answers a link to a %s profile exactly like an unknown link', async (_label, state) => {
    build({
      global_person_claim_tokens: [tokenRow({ ...state })],
      global_persons: [profile('global-1', state)],
      persons: [],
    });
    const unknown = await refusal(confirm('some-other-token'));
    const hidden = await refusal(confirm());
    expect(shapeOf(hidden)).toEqual(shapeOf(unknown));
    expect(shapeOf(unknown)).toMatchObject({ body: { code: 'expired_or_used' } });
    expect(writesTo(db, 'global_persons')).toEqual([]);
    expect(writesTo(db, 'persons')).toEqual([]);
  });

  it('claims nothing when the profile is erased after the link was read', async () => {
    // The link's own read still sees a live profile; the erasure lands before
    // the claim is written. The claim's update must not match an erased row.
    build({
      global_person_claim_tokens: [tokenRow({})],
      global_persons: [profile('global-1', { account_deleted_at: ERASED_AT })],
      persons: [],
    });
    const err = await refusal(confirm());
    expect(shapeOf(err)).toMatchObject({ body: { code: 'already_claimed' } });
    expect(writesTo(db, 'persons')).toEqual([]);
  });

  it.each([
    ['missing', null],
    ['array-shaped', [{}]],
  ])('answers a link whose profile embed is %s like an unknown link', async (_label, embed) => {
    build({
      global_person_claim_tokens: [tokenRow(null, { global_persons: embed })],
      global_persons: [profile('global-1')],
      persons: [],
    });
    expect(shapeOf(await refusal(confirm()))).toEqual(shapeOf(await refusal(confirm('nope'))));
    expect(writesTo(db, 'global_persons')).toEqual([]);
  });

  it('still claims a live profile', async () => {
    build({
      global_person_claim_tokens: [tokenRow({})],
      global_persons: [profile('global-1')],
      persons: [],
    });
    await expect(confirm()).resolves.toEqual({ status: 'claimed', globalPersonId: 'global-1' });
  });

  it("reads the link with its profile's reachability columns", async () => {
    build({
      global_person_claim_tokens: [tokenRow({})],
      global_persons: [profile('global-1')],
      persons: [],
    });
    await confirm();
    expect(selectsFor(db.from, 'global_person_claim_tokens')).toEqual([
      `id, user_id, global_person_id, expires_at, global_persons(${REACHABLE_COLUMNS.join(', ')})`,
    ]);
  });
});

/**
 * Linking at sign-in by email (ruling 106): the address on an erased profile is
 * cleared now, but a profile erased before that, or brought back by an archive
 * restore, still carries it. A new account with that address never links it.
 */
describe('sign-in profile link (ruling 106)', () => {
  const ERASED_WITH_EMAIL = profile('erased', {
    email: USER.email,
    account_deleted_at: ERASED_AT,
  });

  it('never links an erased profile that still carries the address', async () => {
    build({ global_persons: [ERASED_WITH_EMAIL], persons: [], fighter_clubs: [] });
    await service.tryAutolinkGlobalPerson(USER.id, USER.email);
    expect(writesTo(db, 'global_persons')).toEqual([]);
  });

  it('never links an erased profile behind a claimed roster row', async () => {
    build({
      global_persons: [ERASED_WITH_EMAIL],
      persons: [
        { id: 'mine', email: USER.email, claimed_by_user_id: null, global_person_id: 'erased' },
      ],
      fighter_clubs: [],
    });
    await expect(service.claimPersons(signedIn, ['mine'])).resolves.toEqual({ claimed: 1 });
    expect(writesTo(db, 'global_persons')).toEqual([]);
  });

  it('still links a live profile that carries the address', async () => {
    build({
      global_persons: [profile('live', { email: USER.email })],
      persons: [],
      fighter_clubs: [],
    });
    await service.tryAutolinkGlobalPerson(USER.id, USER.email);
    expect(writesTo(db, 'global_persons')[0]?.row).toMatchObject({ claimed_by_user_id: USER.id });
  });
});
