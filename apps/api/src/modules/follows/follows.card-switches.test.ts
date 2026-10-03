/**
 * The three switches of a card of the Following tab speak for EVERY coming Event follow of that
 * person (operator rulings 239, 239a, 239b).
 *
 * Marc follows Paul, who is on the roster of two coming Events, Lyon and Dijon. A follow is saved
 * per Event, so Marc has two follows, and his card has one set of switches. The card used to show
 * the switches of ONE of the two, and a tap was saved for that one alone.
 *
 * The decoys: Marc's follows of Paul in an Event that is over, in a draft Event and in a test
 * Event (the card holds the public's bar, ruling 163), Zoé's follows of Paul in Lyon and Dijon,
 * and Marc's follow of Léa in Lyon.
 */
import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  queriedTables,
  scopedTo,
  selectsFor,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { FollowsService } from './follows.service';

const PAUL = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const LEA = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a02';
const MARC = 'u-marc';
const ZOE = 'u-zoe';

const event = (id: string, status: string, kind = 'standard') => ({
  id,
  status,
  event_kind: kind,
  organization_id: 'org-a',
});
const EVENTS = [
  event('lyon', 'published'),
  event('dijon', 'running'),
  event('nancy', 'published'),
  event('past', 'completed'),
  event('draft', 'draft'),
  event('rehearsal', 'published', 'test'),
];
const eventOf = (id: string) => EVENTS.find((one) => one.id === id);

/** Paul's roster row in each Event (`p-<event>`), Léa's in Lyon, and one with no profile. */
const PERSONS = [
  ...EVENTS.map(({ id, status, event_kind }) => ({
    id: `p-${id}`,
    global_person_id: PAUL,
    event_id: id,
    events: { status, event_kind },
  })),
  { id: 'lea-lyon', global_person_id: LEA, event_id: 'lyon' },
  { id: 'nobody-lyon', global_person_id: null, event_id: 'lyon' },
];

interface Switches {
  match: boolean;
  referee: boolean;
  workshop?: boolean;
}
const follow = (follower: string, personId: string, switches: Switches) => {
  const person = PERSONS.find((row) => row.id === personId);
  const of = eventOf(person?.event_id ?? '');
  return {
    id: `f-${follower}-${personId}`,
    event_id: of?.id,
    followed_person_id: personId,
    follower_user_id: follower,
    created_at: '2026-10-01T00:00:00Z',
    notify_match_start: switches.match,
    notify_workshop_start: switches.workshop ?? false,
    notify_referee_start: switches.referee,
    persons: {
      given_name: 'Paul',
      family_name: 'Durand',
      clubs: null,
      global_person_id: person?.global_person_id,
      events: { status: of?.status, event_kind: of?.event_kind },
    },
  };
};

const ON = { match: true, referee: true, workshop: true };
const OFF = { match: false, referee: false, workshop: false };
/** Marc's two coming follows of Paul, with the switches of each. */
const marcOfPaul = (lyon: Switches, dijon: Switches) => [
  follow(MARC, 'p-lyon', lyon),
  follow(MARC, 'p-dijon', dijon),
];
const DECOYS = [
  follow(MARC, 'p-past', OFF),
  follow(MARC, 'p-draft', OFF),
  follow(MARC, 'p-rehearsal', OFF),
  follow(ZOE, 'p-lyon', OFF),
  follow(ZOE, 'p-dijon', OFF),
  follow(MARC, 'lea-lyon', OFF),
];
/** The bout alert on in both, the referee alert on in Lyon alone. */
const MIXED = marcOfPaul({ match: true, referee: true }, { match: true, referee: false });

function tables(follows: TableSeed): Record<string, TableSeed> {
  return {
    events: { rows: EVENTS },
    persons: { rows: PERSONS },
    // Everybody is entered in a published Tournament of their Event: the public may know them.
    tournaments: {
      rows: EVENTS.map(({ id }) => ({ id: `t-${id}`, event_id: id, status: 'published' })),
    },
    registrations: {
      rows: PERSONS.map(({ id, event_id }) => ({
        id: `r-${id}`,
        person_id: id,
        tournament_id: `t-${event_id}`,
        status: 'registered',
      })),
    },
    matches: { rows: [] },
    event_referees: { rows: [] },
    event_instructors: { rows: [] },
    // The People hub's follow door: the profile is live, and its hub follow is saved.
    global_persons: { data: { id: PAUL }, error: null },
    directory_follows: { data: null, error: null },
    follows,
  };
}

function build(follows: TableSeed = { rows: [...MIXED, ...DECOYS] }) {
  const db = mockSupabase(tables(follows));
  /** How many writes of follows had landed each time the alerts were asked for. */
  const writesWhenAsked: number[] = [];
  const applyFollow = vi.fn(async () => {
    writesWhenAsked.push(writesTo(db, 'follows').length);
  });
  const service = new FollowsService(
    db as never,
    {
      forPerson: vi.fn().mockResolvedValue({ allowBeingFollowed: true }),
      forGlobalPerson: vi.fn().mockResolvedValue({ allowBeingFollowed: true }),
    } as never,
    { applyFollow } as never,
    new OrganizationsService(db as never),
  );
  return { db, service, applyFollow, writesWhenAsked };
}

const cardOf = async (follows?: TableSeed, account = MARC, profile = PAUL) =>
  (await build(follows).service.getEventFollowStateForGlobalPersons(account, [profile])).get(
    profile,
  );

describe('the switches a card shows (ruling 239)', () => {
  it('shows a switch on only when it is on in every coming Event', async () => {
    expect(await cardOf()).toEqual({
      notifyMatchStart: true,
      notifyWorkshopStart: false,
      notifyRefereeStart: false,
    });
  });

  it('shows it on when it is on in both', async () => {
    expect(await cardOf({ rows: [...marcOfPaul(ON, ON), ...DECOYS] })).toEqual({
      notifyMatchStart: true,
      notifyWorkshopStart: true,
      notifyRefereeStart: true,
    });
  });

  it.each(['p-past', 'p-draft', 'p-rehearsal'])(
    'counts no follow the public may not know of, or of an Event that is over: %s alone',
    async (personId) => {
      expect(await cardOf({ rows: [follow(MARC, personId, ON)] })).toBeUndefined();
    },
  );

  it("counts no other account's follows, and no other person's", async () => {
    // Zoé has every switch off in Lyon and Dijon; Marc's follow of Léa has them off too.
    expect(await cardOf({ rows: [...marcOfPaul(ON, ON), ...DECOYS] }, ZOE)).toEqual({
      notifyMatchStart: false,
      notifyWorkshopStart: false,
      notifyRefereeStart: false,
    });
    expect(await cardOf(undefined, MARC, LEA)).toMatchObject({ notifyMatchStart: false });
  });

  it('reads no value that is not exactly true as on', async () => {
    const rows = [
      follow(MARC, 'p-lyon', ON),
      { ...follow(MARC, 'p-dijon', ON), notify_referee_start: null },
    ];
    expect(await cardOf({ rows })).toMatchObject({ notifyRefereeStart: false });
  });

  it('asks for the follow ids and the three switches, of this account', async () => {
    const { db, service } = build();

    await service.getEventFollowStateForGlobalPersons(MARC, [PAUL]);

    expect(selectsFor(db.from, 'follows')).toEqual([
      `id, event_id, followed_person_id, notify_match_start, notify_workshop_start, notify_referee_start,
         persons ( global_person_id, events ( status, event_kind ) )`,
    ]);
    expect(writesTo(db, 'follows')).toEqual([]);
  });

  it('reads nothing when no person is asked for', async () => {
    const { db, service } = build();

    expect(await service.getEventFollowStateForGlobalPersons(MARC, ['', ''])).toEqual(new Map());
    expect(queriedTables(db.from)).toEqual([]);
  });
});

describe('a tap saves the switch on every coming Event follow, in one statement (ruling 239)', () => {
  const TAP = { notifyRefereeStart: true };

  it("writes the tapped switch alone, on Marc's two coming follows of Paul", async () => {
    const { db, service } = build();

    await service.setCardSwitches(PAUL, MARC, TAP);

    const [write, ...others] = writesTo(db, 'follows');
    expect(others).toEqual([]);
    expect(write?.op).toBe('update');
    expect(write?.row).toEqual({ notify_referee_start: true });
    expect(scopedTo(write, 'follower_user_id')).toBe(MARC);
    expect(write?.filters.filter((filter) => filter.method === 'in').map((f) => f.args)).toEqual([
      ['id', ['f-u-marc-p-lyon', 'f-u-marc-p-dijon']],
    ]);
    // PostgREST hands back no row from an update unless asked: the projection is the contract.
    expect(selectsFor(db.from, 'follows')[1]).toBe(
      'followed_person_id, notify_match_start, notify_workshop_start, notify_referee_start',
    );
  });

  it("sets Marc's alerts again for each Event's roster row, after the write", async () => {
    const { service, applyFollow, writesWhenAsked } = build();

    await service.setCardSwitches(PAUL, MARC, TAP);

    expect(applyFollow.mock.calls).toEqual([
      ['p-lyon', MARC],
      ['p-dijon', MARC],
    ]);
    expect(writesWhenAsked).toEqual([1, 1]);
  });

  it('answers the card as the rows were saved', async () => {
    // A canned queue: the read, then what the write hands back.
    const saved = marcOfPaul(ON, { ...ON, workshop: false });
    const { service } = build([
      { data: MIXED, error: null },
      { data: saved, error: null },
    ]);

    await expect(service.setCardSwitches(PAUL, MARC, TAP)).resolves.toEqual({
      notifyMatchStart: true,
      notifyWorkshopStart: false,
      notifyRefereeStart: true,
    });
  });

  it.each<[string, TableSeed]>([
    ['he follows that person in no coming Event', { rows: DECOYS }],
    [
      'the follows went between the read and the write',
      [
        { data: MIXED, error: null },
        { data: [], error: null },
      ],
    ],
  ])('is a 404 when %s, and sets no alert', async (_, follows) => {
    const { service, applyFollow } = build(follows);

    const failure = await service.setCardSwitches(PAUL, MARC, TAP).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(NotFoundException);
    expect((failure as Error).message).toBe('Follow not found');
    expect(applyFollow).not.toHaveBeenCalled();
  });

  it('writes nothing when he follows that person in no coming Event', async () => {
    const { db, service } = build({ rows: DECOYS });

    await service.setCardSwitches(PAUL, MARC, TAP).catch(() => undefined);

    expect(writesTo(db, 'follows')).toEqual([]);
  });

  it('a failed write is a plain Error, and sets no alert', async () => {
    const { service, applyFollow } = build([
      { data: MIXED, error: null },
      { data: null, error: { message: 'boom' } },
    ]);

    const failure = await service.setCardSwitches(PAUL, MARC, TAP).catch((e: unknown) => e);

    expect((failure as Error).constructor).toBe(Error);
    expect((failure as Error).message).toBe('follow switches write failed: boom');
    expect(applyFollow).not.toHaveBeenCalled();
  });

  it('alerts that cannot be set fail the call, with the switches saved', async () => {
    const { db, service, applyFollow } = build();
    applyFollow.mockRejectedValueOnce(new Error('Bouts of a followed person unreadable: boom'));

    await expect(service.setCardSwitches(PAUL, MARC, TAP)).rejects.toThrow('unreadable: boom');

    expect(writesTo(db, 'follows')).toHaveLength(1);
  });
});

describe("a new follow takes the card's switches (ruling 239b)", () => {
  const NANCY = ['nancy', 'p-nancy'] as const;
  const inserted = (db: ReturnType<typeof mockSupabase>) =>
    writesTo(db, 'follows').find((write) => write.op === 'insert')?.row;
  /** What the database adds to the new follow: the insert reads its row back. */
  const returning = { id: 'f-new', created_at: '2026-10-04T00:00:00Z' };

  it('Marc follows Paul at Nancy: the follow is saved with his card as it stands', async () => {
    // His card: the bout alert off, the referee alert on, in Lyon and in Dijon.
    const card = { match: false, referee: true };
    const { db, service } = build({ rows: [...marcOfPaul(card, card), ...DECOYS], returning });

    await service.follow(...NANCY, { userId: MARC });

    expect(inserted(db)).toMatchObject({
      event_id: 'nancy',
      followed_person_id: 'p-nancy',
      notify_match_start: false,
      notify_workshop_start: false,
      notify_referee_start: true,
    });
  });

  it('a tap on Follow in the People hub: the Event that is new takes the card too', async () => {
    const card = { match: false, referee: true };
    const { db, service, applyFollow } = build({
      rows: [...marcOfPaul(card, card), ...DECOYS],
      returning,
    });

    const summary = await service.followAllEvents(PAUL, { userId: MARC });

    // Lyon and Dijon were followed; Nancy is the one new follow.
    expect(summary).toMatchObject({ alreadyFollowingCount: 2, followedCount: 1 });
    expect(inserted(db)).toMatchObject({
      event_id: 'nancy',
      notify_match_start: false,
      notify_referee_start: true,
    });
    expect(applyFollow).toHaveBeenCalledWith('p-nancy', MARC);
  });

  it.each<[string, Parameters<FollowsService['follow']>]>([
    ['a first follow of that person', ['nancy', 'p-nancy', { userId: 'u-new' }]],
    ['a follow of a roster row with no profile', ['lyon', 'nobody-lyon', { userId: MARC }]],
    [
      'a guest session, which has no card',
      ['nancy', 'p-nancy', { guestSessionId: 'g1', guestEventId: 'nancy' }],
    ],
  ])('%s starts told of the bouts alone', async (_, call) => {
    const { db, service } = build({ rows: [...MIXED, ...DECOYS], returning });

    await service.follow(...call);

    expect(inserted(db)).toMatchObject({
      notify_match_start: true,
      notify_workshop_start: false,
      notify_referee_start: false,
    });
  });

  it('a failed read of the followed person fails the follow, before anything is written', async () => {
    const db = mockSupabase({
      ...tables({ rows: [] }),
      persons: { data: null, error: { message: 'boom' } },
    });
    const service = new FollowsService(
      db as never,
      { forPerson: vi.fn().mockResolvedValue({ allowBeingFollowed: true }) } as never,
      { applyFollow: vi.fn() } as never,
      new OrganizationsService(db as never),
    );

    await expect(service.follow(...NANCY, { userId: MARC })).rejects.toThrow(
      'followed person read failed: boom',
    );
    expect(db.writes).toEqual([]);
  });
});
