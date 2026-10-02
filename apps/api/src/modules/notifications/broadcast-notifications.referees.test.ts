/**
 * A broadcast to the referees of an Event: who it reaches (operator ruling 216).
 *
 * Claire sends "Briefing at 9" to the referees of the Open. Zoé referees and fights there: she has
 * a roster row. Paul was taken from the directory: he has a profile and an account, and no roster
 * row in the Open. Tom was taken from the directory too, and no account holds his profile.
 *
 * Paul's recipient used to name his PROFILE's id as its roster row. The database refuses that id
 * (`event_broadcast_recipients.person_id` references `persons(id)`), so the whole broadcast
 * answered 400 and Zoé was not told either. Now Paul is told through his account, at its own
 * address, his recipient names no roster row, and Tom is left out: nobody can be told.
 */
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lastFunctionParams } from '../../common/testing/migration-function';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  writesTo,
  type SupabaseRow,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { BroadcastNotificationsService } from './broadcast-notifications.service';

const OPEN = 'e-open';
const LONGSWORD = 't-longsword';
const PAUL = 'gp-paul';
const ZOE = 'gp-zoe';
const TOM = 'gp-tom';

const ZOE_ROW = {
  id: 'p-zoe',
  event_id: OPEN,
  global_person_id: ZOE,
  claimed_by_user_id: 'u-zoe',
  email: 'zoe@roster.example',
};
/** Paul fights in ANOTHER Event: that roster row is no row of the Open. */
const PAUL_ELSEWHERE = {
  id: 'p-paul-elsewhere',
  event_id: 'e-other',
  global_person_id: PAUL,
  claimed_by_user_id: 'u-paul',
  email: 'paul@other-event.example',
};
const PROFILES = [
  { id: PAUL, claimed_by_user_id: 'u-paul' },
  { id: ZOE, claimed_by_user_id: 'u-zoe' },
  { id: TOM, claimed_by_user_id: null },
];
const qualified = (...profiles: string[]) =>
  profiles.map((profile) => ({ event_id: OPEN, person_id: profile, active: true }));

function tables(referees: string[], over: Record<string, TableSeed> = {}) {
  return {
    events: { rows: [{ id: OPEN, organization_id: 'o-lyon', slug: 'open', name: 'Open' }] },
    referee_qualifications: { rows: qualified(...referees) },
    referee_assignments: { rows: [] },
    persons: { rows: [ZOE_ROW, PAUL_ELSEWHERE] },
    global_persons: { rows: PROFILES },
    event_broadcast_notifications: { rows: [], returning: { id: 'b-1' } },
    event_broadcast_recipients: {
      rows: [],
      returning: (_row: SupabaseRow, at: number) => ({ id: `r-${at + 1}` }),
    },
    audit_log: { rows: [] },
    ...over,
  } satisfies Record<string, TableSeed>;
}

const rpc = vi.fn();
const scheduler = { sendImmediate: vi.fn() };
let warn: ReturnType<typeof vi.spyOn>;

/** Claire sends the briefing; what was saved, and what was queued. */
async function briefing(
  seed: Record<string, TableSeed>,
  target: { targetType: string; tournamentId?: string } = { targetType: 'referees' },
) {
  const db = mockSupabase(seed);
  const service = new BroadcastNotificationsService(
    { service: { from: db.from, rpc } } as never,
    { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
    scheduler as never,
  );
  const sent = service.sendBroadcast(OPEN, 'u-claire', {
    ...target,
    severity: 'info',
    title: 'Briefing',
    body: 'At 9 in hall B.',
  } as never);
  return { db, sent };
}

const saved = (db: ReturnType<typeof mockSupabase>) =>
  writesTo(db, 'event_broadcast_recipients').flatMap((write) => write.row as SupabaseRow[]);
const queued = () =>
  scheduler.sendImmediate.mock.calls.map(([job]) => [
    job.recipientId,
    job.userId,
    job.email,
    job.forceEmail,
  ]);

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: [{ user_id: 'u-paul', email: 'paul@account.example' }],
    error: null,
  });
  scheduler.sendImmediate.mockReset();
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a broadcast to the referees of an Event (ruling 216)', () => {
  it('names no roster row for a referee who has none in the Event', async () => {
    const { db, sent } = await briefing(tables([ZOE, PAUL]));

    await expect(sent).resolves.toEqual({ id: 'b-1', recipientCount: 2 });
    expect(saved(db).map((row) => [row['person_id'], row['user_id']])).toEqual([
      ['p-zoe', 'u-zoe'],
      [null, 'u-paul'],
    ]);
  });

  it('tells him through his account, at its own address, read in one call', async () => {
    const { sent } = await briefing(tables([ZOE, PAUL]));
    await sent;

    expect(queued()).toEqual([
      ['r-1', 'u-zoe', 'zoe@roster.example', false],
      ['r-2', 'u-paul', 'paul@account.example', false],
    ]);
    expect(rpc.mock.calls).toEqual([['account_emails', { p_user_ids: ['u-paul'] }]]);
    expect(Object.keys(rpc.mock.calls[0]![1])).toEqual(lastFunctionParams('account_emails'));
  });

  it('does not save his account address with the broadcast', async () => {
    const { db, sent } = await briefing(tables([ZOE, PAUL]));
    await sent;

    expect(saved(db).map((row) => [row['user_id'], row['email']])).toEqual([
      ['u-zoe', 'zoe@roster.example'],
      ['u-paul', null],
    ]);
  });

  it('reads the holder of his profile, and never the address the profile carries', async () => {
    const { db, sent } = await briefing(tables([ZOE, PAUL]));
    await sent;

    expect(selectsFor(db.from, 'global_persons')).toEqual(['id, claimed_by_user_id']);
    expect(filtersFor(db.from, 'global_persons', 'in')).toEqual([['id', [PAUL]]]);
    expect(selectsFor(db.from, 'persons')).toEqual([
      'id, global_person_id, claimed_by_user_id, email',
    ]);
  });

  it('leaves out a referee whose profile no account holds, and says so', async () => {
    const { db, sent } = await briefing(tables([ZOE, TOM, PAUL]));

    await expect(sent).resolves.toEqual({ id: 'b-1', recipientCount: 2 });
    expect(saved(db).map((row) => row['user_id'])).toEqual(['u-zoe', 'u-paul']);
    expect(writesTo(db, 'event_broadcast_notifications').map((write) => write.row)).toEqual([
      expect.objectContaining({ recipient_count: 2 }),
    ]);
    expect(warn.mock.calls).toEqual([
      [`Broadcast of ${OPEN}: 1 referee(s) left out, no roster row here and no account: ${TOM}`],
    ]);
  });

  it('refuses a broadcast that nobody can be told, and saves nothing', async () => {
    const { db, sent } = await briefing(tables([TOM]));

    await expect(sent).rejects.toMatchObject({ status: 400, message: 'No recipients matched' });
    expect(db.writes).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('still tells him on his phone when the addresses cannot be read', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    const { sent } = await briefing(tables([PAUL]));
    await sent;

    expect(queued()).toEqual([['r-1', 'u-paul', null, false]]);
    expect(warn.mock.calls).toEqual([
      [`Broadcast of ${OPEN}: account addresses unreadable: permission denied`],
    ]);
  });

  it('reads no profile and no account when every referee has a roster row', async () => {
    const { db, sent } = await briefing(tables([ZOE]));
    await sent;

    expect(queriedTables(db.from)).not.toContain('global_persons');
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['persons', 'Referee roster rows unreadable: boom'],
    ['global_persons', 'Referee profiles unreadable: boom'],
  ])('fails whole, as a server error, when %s cannot be read', async (table, message) => {
    const { db, sent } = await briefing(
      tables([ZOE, PAUL], { [table]: { data: null, error: { message: 'boom' } } }),
    );

    const failure = await sent.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({ message });
    expect(failure).not.toHaveProperty('status');
    expect(db.writes).toEqual([]);
  });

  it('tells an account once when it also holds a Fighter’s roster row in the Event', async () => {
    const paulFights = {
      id: 'p-paul-fighter',
      event_id: OPEN,
      global_person_id: null,
      claimed_by_user_id: 'u-paul',
      email: 'paul@roster.example',
    };
    const { db, sent } = await briefing(
      tables([PAUL], {
        persons: { rows: [ZOE_ROW, PAUL_ELSEWHERE, paulFights] },
        tournaments: { rows: [{ id: LONGSWORD, event_id: OPEN }] },
        registrations: {
          rows: [{ tournament_id: LONGSWORD, person_id: 'p-paul-fighter', status: 'registered' }],
        },
      }),
      { targetType: 'fighters_and_referees' },
    );

    await expect(sent).resolves.toEqual({ id: 'b-1', recipientCount: 1 });
    expect(saved(db).map((row) => [row['person_id'], row['user_id'], row['email']])).toEqual([
      ['p-paul-fighter', 'u-paul', 'paul@roster.example'],
    ]);
  });

  it('reaches the referees of one Tournament the same way', async () => {
    const { db, sent } = await briefing(
      tables([], {
        tournaments: { rows: [{ id: LONGSWORD, event_id: OPEN }] },
        phases: { rows: [{ id: 'ph-1', tournament_id: LONGSWORD }] },
        pools: { rows: [{ id: 'pool-a', phase_id: 'ph-1' }] },
        matches: { rows: [] },
        referee_assignments: {
          rows: [
            { event_id: OPEN, person_id: PAUL, pool_id: 'pool-a', match_id: null },
            { event_id: OPEN, person_id: ZOE, pool_id: 'pool-other', match_id: null },
          ],
        },
      }),
      { targetType: 'referees', tournamentId: LONGSWORD },
    );

    await expect(sent).resolves.toEqual({ id: 'b-1', recipientCount: 1 });
    expect(saved(db).map((row) => [row['person_id'], row['user_id']])).toEqual([[null, 'u-paul']]);
  });
});
