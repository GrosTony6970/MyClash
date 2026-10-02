/**
 * Who is alerted before a referee's duty (operator rulings 217, 217a, 217b).
 *
 * Paul referees at the Open, taken from the directory: he has no roster row there. Marc follows
 * him from the People hub. A follower's referee alert was looked up through the roster rows of the
 * Event only, so nothing could ring for Marc. Now the hub follow carries its own switch, and it
 * covers every Event where the FOLLOWER has no Event follow of that person; where he has one,
 * that Event's own switch decides. In a TEST Event, which the public cannot open, it rings only
 * for a member of the Event's organisation (ruling 217c).
 */
import { describe, expect, it } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  type TableSeed,
} from '../common/testing/supabase-chain';
import { refereeAlertFollowers, type RowsOf } from './referee-alert-followers';

const rosterRow = (id: string, profile: string, eventId: string) => ({
  id,
  global_person_id: profile,
  event_id: eventId,
});
const eventFollow = (follower: string | null, person: string, on: boolean) => ({
  follower_user_id: follower,
  followed_person_id: person,
  notify_referee_start: on,
});
const hubFollow = (follower: string, profile: string, on?: boolean) => ({
  follower_user_id: follower,
  followed_global_person_id: profile,
  // No value = a row with no such column, as the double reads a column nobody seeded.
  ...(on === undefined ? {} : { notify_referee_start: on }),
});

/**
 * Paul referees in the Open with no roster row there; in the Cup he has one. Léa has a roster row
 * in the Open. The decoys: a hub follower of Léa, and a follow of Paul's row in the Cup.
 */
function tables(overrides: Record<string, TableSeed> = {}): Record<string, TableSeed> {
  return {
    persons: {
      rows: [rosterRow('paul-cup', 'gp-paul', 'cup'), rosterRow('lea-open', 'gp-lea', 'open')],
    },
    follows: { rows: [eventFollow('zoe', 'paul-cup', true)] },
    directory_follows: { rows: [hubFollow('ana', 'gp-lea', true)] },
    events: {
      rows: [
        { id: 'open', event_kind: 'standard', organization_id: 'org-a' },
        { id: 'cup', event_kind: 'club', organization_id: 'org-a' },
        { id: 'rehearsal', event_kind: 'test', organization_id: 'org-a' },
      ],
    },
    // Marc is a member of the club that runs the three Events; Nina, of another club.
    organization_members: {
      rows: [
        { organization_id: 'org-a', user_id: 'marc' },
        { organization_id: 'org-b', user_id: 'nina' },
      ],
    },
    ...overrides,
  };
}

const BOOM = { data: null, error: { message: 'boom' } };
/** The fire-time rule: a failed read throws. */
const strict: RowsOf = (what, { data, error }) => {
  if (error) throw new Error(`${what} read failed: ${error.message}`);
  return data;
};
/** The rule of a lock: a failed read is said, and answers nothing. */
function lenient() {
  const said: string[] = [];
  const rows: RowsOf = (what, { data, error }, loses) => {
    if (error) said.push(`${what} unreadable; ${loses}: ${error.message}`);
    return data;
  };
  return { rows, said };
}

function ask(
  duty: { profileId: string; eventId: string },
  overrides: Record<string, TableSeed> = {},
  onlyFollower?: string,
) {
  const db = mockSupabase(tables(overrides));
  return { db, answer: refereeAlertFollowers(db.service as never, duty, strict, onlyFollower) };
}

const PAUL_AT_THE_OPEN = { profileId: 'gp-paul', eventId: 'open' };
const PAUL_AT_THE_REHEARSAL = { profileId: 'gp-paul', eventId: 'rehearsal' };
const LEA_AT_THE_OPEN = { profileId: 'gp-lea', eventId: 'open' };

describe('a hub follow rings before the duties of a referee with no roster row (ruling 217)', () => {
  it('alerts Marc, whose hub switch is on', async () => {
    const hub = { directory_follows: { rows: [hubFollow('marc', 'gp-paul', true)] } };

    await expect(ask(PAUL_AT_THE_OPEN, hub).answer).resolves.toEqual(['marc']);
  });

  it.each<[string, ReturnType<typeof hubFollow>]>([
    ['is off, as it is at first (ruling 217a)', hubFollow('marc', 'gp-paul', false)],
    ['was never saved: a missing value is not "on"', hubFollow('marc', 'gp-paul')],
    ['is on for another person', hubFollow('marc', 'gp-lea', true)],
  ])('alerts nobody when his hub switch %s', async (_, row) => {
    const { answer } = ask(PAUL_AT_THE_OPEN, { directory_follows: { rows: [row] } });

    await expect(answer).resolves.toEqual([]);
  });

  it('reads no Event follow when the referee has no roster row there', async () => {
    const { db, answer } = ask(PAUL_AT_THE_OPEN);

    await answer;

    expect(queriedTables(db.from)).toEqual(['persons', 'directory_follows']);
  });
});

describe('in a TEST Event the hub switch rings for the club’s own members only (ruling 217c)', () => {
  const everyHubSwitchOn = {
    directory_follows: {
      rows: [
        hubFollow('marc', 'gp-paul', true),
        hubFollow('nina', 'gp-paul', true),
        hubFollow('zoe', 'gp-paul', true),
      ],
    },
  };

  it('alerts Marc, a member of the Event’s club; not a member of another club, not the public', async () => {
    const { db, answer } = ask(PAUL_AT_THE_REHEARSAL, everyHubSwitchOn);

    await expect(answer).resolves.toEqual(['marc']);
    expect(selectsFor(db.from, 'events')).toEqual(['event_kind, organization_id']);
    expect(filtersFor(db.from, 'events', 'eq')).toEqual([['id', 'rehearsal']]);
    expect(selectsFor(db.from, 'organization_members')).toEqual(['user_id']);
    expect(filtersFor(db.from, 'organization_members', 'eq')).toEqual([
      ['organization_id', 'org-a'],
    ]);
  });

  it.each<[string, { profileId: string; eventId: string }]>([
    ['a standard Event', PAUL_AT_THE_OPEN],
    ['a club Event', { profileId: 'gp-lea', eventId: 'cup' }],
  ])('alerts every hub follower in %s, and asks for no membership', async (_, duty) => {
    const hub = {
      directory_follows: {
        rows: ['marc', 'nina', 'zoe'].map((id) => hubFollow(id, duty.profileId, true)),
      },
    };
    const { db, answer } = ask(duty, hub);

    await expect(answer).resolves.toEqual(['marc', 'nina', 'zoe']);
    expect(queriedTables(db.from)).not.toContain('organization_members');
  });

  it('asks no membership of an Event follower: the ruling is about the hub switch', async () => {
    const { db, answer } = ask(
      { profileId: 'gp-lea', eventId: 'rehearsal' },
      {
        persons: { rows: [rosterRow('lea-rehearsal', 'gp-lea', 'rehearsal')] },
        follows: { rows: [eventFollow('zoe', 'lea-rehearsal', true)] },
        directory_follows: { rows: [] },
      },
    );

    await expect(answer).resolves.toEqual(['zoe']);
    expect(queriedTables(db.from)).toEqual(['persons', 'follows', 'directory_follows']);
  });

  it('asked for one follower, reads his membership alone', async () => {
    const { db, answer } = ask(PAUL_AT_THE_REHEARSAL, everyHubSwitchOn, 'nina');

    await expect(answer).resolves.toEqual([]);
    expect(filtersFor(db.from, 'organization_members', 'eq')).toEqual([
      ['organization_id', 'org-a'],
      ['user_id', 'nina'],
    ]);
  });
});

describe('where the follower has an Event follow, that Event’s own switch decides (ruling 217b)', () => {
  const hubOn = { rows: [hubFollow('marc', 'gp-lea', true), hubFollow('nina', 'gp-lea', true)] };

  it('his Event follow with the switch off silences his hub switch there', async () => {
    const { answer } = ask(LEA_AT_THE_OPEN, {
      follows: { rows: [eventFollow('marc', 'lea-open', false)] },
      directory_follows: hubOn,
    });

    // Nina has no Event follow of Léa in the Open: her hub switch covers it.
    await expect(answer).resolves.toEqual(['nina']);
  });

  it('his Event follow with the switch on alerts him once, with or without a hub follow', async () => {
    const { answer } = ask(LEA_AT_THE_OPEN, {
      follows: {
        rows: [eventFollow('marc', 'lea-open', true), eventFollow('zoe', 'lea-open', true)],
      },
      directory_follows: { rows: [hubFollow('marc', 'gp-lea', true)] },
    });

    await expect(answer).resolves.toEqual(['marc', 'zoe']);
  });

  it('an Event follow whose switch was never read is not "on", and still decides', async () => {
    const { answer } = ask(LEA_AT_THE_OPEN, {
      follows: { rows: [{ follower_user_id: 'marc', followed_person_id: 'lea-open' }] },
      directory_follows: { rows: [hubFollow('marc', 'gp-lea', true)] },
    });

    await expect(answer).resolves.toEqual([]);
  });

  it('an Event follow in ANOTHER Event decides nothing here', async () => {
    const { answer } = ask(LEA_AT_THE_OPEN, {
      persons: {
        rows: [rosterRow('lea-open', 'gp-lea', 'open'), rosterRow('lea-cup', 'gp-lea', 'cup')],
      },
      follows: { rows: [eventFollow('marc', 'lea-cup', false)] },
      directory_follows: { rows: [hubFollow('marc', 'gp-lea', true)] },
    });

    await expect(answer).resolves.toEqual(['marc']);
  });

  it('a guest session’s Event follow is nobody: it has no account to tell', async () => {
    const { answer } = ask(LEA_AT_THE_OPEN, {
      follows: { rows: [eventFollow(null, 'lea-open', true)] },
      directory_follows: { rows: [] },
    });

    await expect(answer).resolves.toEqual([]);
  });
});

describe('asked for one follower, it answers for him alone', () => {
  const both = {
    follows: {
      rows: [eventFollow('zoe', 'lea-open', true), eventFollow('marc', 'lea-open', true)],
    },
    directory_follows: { rows: [hubFollow('nina', 'gp-lea', true)] },
  };

  it.each<[string, string[]]>([
    ['marc', ['marc']],
    ['nina', ['nina']],
    ['', []],
  ])('for "%s"', async (follower, expected) => {
    const { db, answer } = ask(LEA_AT_THE_OPEN, both, follower);

    await expect(answer).resolves.toEqual(expected);
    expect(filtersFor(db.from, 'follows', 'eq')).toEqual([['follower_user_id', follower]]);
    expect(filtersFor(db.from, 'directory_follows', 'eq')).toContainEqual([
      'follower_user_id',
      follower,
    ]);
  });
});

describe('what it reads', () => {
  it('asks for columns the tables have, and for this person in this Event', async () => {
    const { db, answer } = ask(LEA_AT_THE_OPEN);

    await answer;

    expect(selectsFor(db.from, 'persons')).toEqual(['id']);
    expect(selectsFor(db.from, 'follows')).toEqual(['follower_user_id, notify_referee_start']);
    expect(selectsFor(db.from, 'directory_follows')).toEqual(['follower_user_id']);
    expect(filtersFor(db.from, 'persons', 'eq')).toEqual([
      ['global_person_id', 'gp-lea'],
      ['event_id', 'open'],
    ]);
    expect(filtersFor(db.from, 'follows', 'in')).toEqual([['followed_person_id', ['lea-open']]]);
    expect(filtersFor(db.from, 'follows', 'eq')).toEqual([]);
    expect(filtersFor(db.from, 'directory_follows', 'eq')).toEqual([
      ['followed_global_person_id', 'gp-lea'],
      ['notify_referee_start', true],
    ]);
  });

  it.each<[string, string]>([
    ['persons', 'Roster rows of a referee read failed: boom'],
    ['follows', 'Followers of a referee read failed: boom'],
    ['directory_follows', 'Hub followers of a referee read failed: boom'],
    ['events', 'Event of a duty read failed: boom'],
  ])('hands a failed read of %s to its caller’s rule', async (table, message) => {
    const { answer } = ask(LEA_AT_THE_OPEN, { [table]: BOOM });

    await expect(answer).rejects.toThrow(message);
  });

  it('hands a failed read of the members of a test Event’s club to its caller’s rule', async () => {
    const { answer } = ask(PAUL_AT_THE_REHEARSAL, {
      directory_follows: { rows: [hubFollow('marc', 'gp-paul', true)] },
      organization_members: BOOM,
    });

    await expect(answer).rejects.toThrow('Members of the club of a test Event read failed: boom');
  });
});

describe('a caller that goes on after a failed read (a lock)', () => {
  const world = {
    follows: {
      rows: [eventFollow('marc', 'lea-open', false), eventFollow('zoe', 'lea-open', true)],
    },
    directory_follows: { rows: [hubFollow('marc', 'gp-lea', true)] },
  };
  const at = (overrides: Record<string, TableSeed>) => {
    const db = mockSupabase(tables({ ...world, ...overrides }));
    const { rows, said } = lenient();
    return { said, answer: refereeAlertFollowers(db.service as never, LEA_AT_THE_OPEN, rows) };
  };

  it.each<[string, string]>([
    ['persons', 'Roster rows of a referee unreadable; no follower reminder set: boom'],
    ['follows', 'Followers of a referee unreadable; no follower reminder set: boom'],
  ])(
    'alerts nobody when %s cannot be read: it is not "no Event follow", which would ring Marc',
    async (table, warning) => {
      const { said, answer } = at({ [table]: BOOM });

      await expect(answer).resolves.toEqual([]);
      expect(said).toEqual([warning]);
    },
  );

  it.each<[string, Record<string, TableSeed>, string]>([
    ['the hub follows', { directory_follows: BOOM }, 'Hub followers of a referee'],
    [
      'the Event',
      { directory_follows: { rows: [hubFollow('nina', 'gp-lea', true)] }, events: BOOM },
      'Event of a duty',
    ],
    [
      'the members of a test Event’s club',
      {
        // The Open as a TEST Event: Nina's hub switch needs her membership, which cannot be read.
        events: { rows: [{ id: 'open', event_kind: 'test', organization_id: 'org-b' }] },
        directory_follows: { rows: [hubFollow('nina', 'gp-lea', true)] },
        organization_members: BOOM,
      },
      'Members of the club of a test Event',
    ],
  ])(
    'still alerts the Event followers when %s cannot be read, and says who is not told',
    async (_, overrides, what) => {
      const { said, answer } = at(overrides);

      await expect(answer).resolves.toEqual(['zoe']);
      expect(said).toEqual([`${what} unreadable; the hub followers get no reminder: boom`]);
    },
  );
});
