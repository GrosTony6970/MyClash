/**
 * The Swiss round message goes out only for a Tournament the public can open (ruling 198, the bar
 * of rulings 196 and 197). Claire runs a Swiss Longsword, already published, inside the Winter
 * Games, still a draft. Each new round used to tell Marie "Round 2: you face Paul on Piste 3", with
 * a link to a page that answers "not found" for her. Now a draft Event is silent, and a TEST Event
 * too: its pages are hidden from everyone outside the club. Nothing is sent later: a pairing is
 * news only at its moment. The log says a round was dropped.
 */
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { mockSupabase, selectsFor, type TableSeed } from '../../../common/testing/supabase-chain';
import { NotificationEventsService } from './notification-events.service';

const ROUND = 'round-2';
type EventEmbed = { slug: string; status?: string; event_kind?: string } | null;

/** The field of round 2: Marie against Paul on Piste 3, both with a linked account. */
const FIELD: Record<string, TableSeed> = {
  swiss_entrants: {
    rows: [
      {
        phase_id: 'phase-1',
        registration_id: 'reg-marie',
        withdrawn_at_round: null,
        registrations: { person_id: 'p-marie' },
      },
      {
        phase_id: 'phase-1',
        registration_id: 'reg-paul',
        withdrawn_at_round: null,
        registrations: { person_id: 'p-paul' },
      },
    ],
  },
  matches: {
    rows: [
      {
        swiss_round_id: ROUND,
        red_registration_id: 'reg-marie',
        blue_registration_id: 'reg-paul',
        lices: { name: 'Piste 3' },
      },
    ],
  },
  registrations: {
    rows: [
      { id: 'reg-marie', persons: { given_name: 'Marie', family_name: 'Martin' } },
      { id: 'reg-paul', persons: { given_name: 'Paul', family_name: 'Petit' } },
    ],
  },
  persons: {
    rows: [
      { id: 'p-marie', claimed_by_user_id: 'u-marie', email: 'marie@example.com' },
      { id: 'p-paul', claimed_by_user_id: 'u-paul', email: 'paul@example.com' },
    ],
  },
};

function tables(tournamentStatus: string, events: EventEmbed): Record<string, TableSeed> {
  const tournaments = { name: 'Longsword', slug: 'longsword', status: tournamentStatus, events };
  const round = { id: ROUND, round_number: 2, phase_id: 'phase-1', bye_registration_id: null };
  return { ...FIELD, swiss_rounds: { rows: [{ ...round, phases: { tournaments } }] } };
}

const winterGames = (status: string, kind = 'standard'): EventEmbed => ({
  slug: 'winter-games',
  status,
  event_kind: kind,
});

const DROPPED = `Dropped swiss_round_published for ${ROUND}: hidden`;
const scheduler = { sendImmediateBulk: vi.fn() };
let db: ReturnType<typeof mockSupabase>;
let log: MockInstance<Logger['log']>;

async function told(seed: Record<string, TableSeed>): Promise<Array<Record<string, unknown>>> {
  db = mockSupabase(seed);
  await new NotificationEventsService(db as never, scheduler as never).swissRoundPublished(ROUND);
  return scheduler.sendImmediateBulk.mock.calls.flatMap(
    ([jobs]) => jobs as Array<Record<string, unknown>>,
  );
}

beforeEach(() => {
  scheduler.sendImmediateBulk.mockReset();
  log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Swiss round message of a public Tournament', () => {
  it.each(['published', 'running', 'completed'])(
    'tells Marie and Paul in a %s Event',
    async (status) => {
      const jobs = await told(tables('running', winterGames(status)));
      const page = '/e/winter-games/t/longsword#swiss';
      const toMarie = 'Round 2: you face Paul Petit on Piste 3.';
      const toPaul = 'Round 2: you face Marie Martin on Piste 3.';
      expect(jobs.map((job) => [job['userId'], job['body'], job['url']])).toEqual([
        ['u-marie', `Ronde 2 : vous affrontez Paul Petit sur Piste 3. / ${toMarie}`, page],
        ['u-paul', `Ronde 2 : vous affrontez Marie Martin sur Piste 3. / ${toPaul}`, page],
      ]);
      expect(jobs[0]).toMatchObject({
        title: 'Longsword — ronde 2 / Longsword — round 2',
        emailSubject: 'Longsword : appariements de la ronde 2 / Longsword: round 2 pairings',
      });
      expect(log).not.toHaveBeenCalledWith(DROPPED);
    },
  );

  it('calls an opponent whose name cannot be read "your next opponent", in each language', async () => {
    const registrations = {
      rows: [
        { id: 'reg-marie', persons: { given_name: 'Marie', family_name: 'Martin' } },
        { id: 'reg-paul', persons: null },
      ],
    };
    const jobs = await told({ ...tables('running', winterGames('running')), registrations });
    expect(jobs.find((job) => job['userId'] === 'u-marie')?.['body']).toBe(
      'Ronde 2 : vous affrontez votre prochain adversaire sur Piste 3. / Round 2: you face your next opponent on Piste 3.',
    );
  });

  it('tells them in a club Event: its pages are public', async () => {
    expect(await told(tables('running', winterGames('running', 'club')))).toHaveLength(2);
  });

  it.each<[string, string, EventEmbed]>([
    ['a draft Event', 'running', winterGames('draft')],
    ['a running TEST Event', 'running', winterGames('running', 'test')],
    [
      'an Event read without its status',
      'running',
      { slug: 'winter-games', event_kind: 'standard' },
    ],
    ['a Tournament read without its Event', 'running', null],
    ['a draft Tournament of a public Event', 'draft', winterGames('running')],
  ])('tells nobody in %s, and says so in the log', async (_, tournamentStatus, events) => {
    expect(await told(tables(tournamentStatus, events))).toEqual([]);
    expect(log).toHaveBeenCalledWith(DROPPED);
  });

  it('tells nobody about a round that is gone', async () => {
    expect(await told({ ...FIELD, swiss_rounds: { rows: [] } })).toEqual([]);
  });

  it('reads the round with its Tournament status, and its Event with status and kind', async () => {
    await told(tables('running', winterGames('running')));
    // The double ignores projections: a kind left out of the read would count as a standard Event.
    expect(selectsFor(db.from, 'swiss_rounds')).toEqual([
      'id, round_number, phase_id, bye_registration_id, ' +
        'phases ( tournaments ( name, slug, status, events ( slug, status, event_kind ) ) )',
    ]);
  });
});
