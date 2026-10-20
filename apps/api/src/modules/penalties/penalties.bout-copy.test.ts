import { describe, expect, it, vi } from 'vitest';
import { lastFunctionParams } from '../../common/testing/migration-function';
import {
  mockSupabase,
  selectsFor,
  supabaseChain,
  writesTo,
  type ChainResult,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { PenaltiesService } from './penalties.service';

/**
 * A bout keeps the card rules it started under (migration 0229): its copy of its rules pins them,
 * and a card is priced and laddered from that pin. How far a black card reaches is the
 * Tournament's of now (rulings A and G, 2026-10-17): its current card rules (ruling 54). So each
 * story below seeds two answers: the bout's copy says one thing, and its Tournament now says
 * another.
 */

/** The card rules the bout started under, in most stories. */
const CARDS_A = {
  id: 'cards-a',
  built_in: false,
  owner_organization_id: 'org-1',
  accumulation_scope: 'match',
  yellow_card_points: -1,
  red_card_points: -2,
  black_card_points: 0,
  first_black_card_forfeit: 'tournament',
  second_black_card_forfeit: 'tournament',
};
/** The card rules the Tournament moved to since. */
const CARDS_B = {
  ...CARDS_A,
  id: 'cards-b',
  accumulation_scope: 'tournament',
  yellow_card_points: -3,
  red_card_points: -4,
  first_black_card_forfeit: 'match',
};
const BUILT_IN = {
  ...CARDS_A,
  id: 'built-in',
  built_in: true,
  owner_organization_id: null,
  yellow_card_points: -5,
  red_card_points: -6,
};

interface Story {
  /** The card rules the bout's copy pins. Null reads as the built-in. */
  copyPin: string | null;
  /** The card rules the Tournament pins now. */
  tournamentPin: string | null;
  /** The Tournament's `ruleset_config` now. */
  rulesetConfig?: Record<string, unknown>;
  /** Cards the server already holds. */
  cards?: Record<string, unknown>[];
}

/** The running bout of the story, with its copy of its rules. */
const boutRow = (story: Story) => ({
  id: 'm1',
  status: 'running',
  phase_id: 'phase-1',
  red_registration_id: 'reg-red',
  blue_registration_id: 'reg-blue',
  locked_at: null,
  current_round: 1,
  awaiting_round_advance: false,
  match_rules: { penalty_ruleset_id: story.copyPin },
});

function bout(story: Story) {
  const db = mockSupabase({
    matches: { rows: [boutRow(story)] },
    phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1' }] },
    tournaments: {
      rows: [
        {
          id: 'tournament-1',
          event_id: 'event-1',
          penalty_ruleset_id: story.tournamentPin,
          ruleset_config: story.rulesetConfig ?? {},
        },
      ],
    },
    events: {
      rows: [{ id: 'event-1', organization_id: 'org-1', penalty_ruleset_id: null }],
    },
    penalty_rulesets: { rows: [CARDS_A, CARDS_B, BUILT_IN] },
    penalty_ruleset_entries: {
      rows: [{ id: 'entry-1', group_number: 3, ref_number: '6', sanctions: ['yellow', 'red'] }],
    },
    match_penalties: { rows: story.cards ?? [], returning: { id: 'card-new' } },
    match_events: { rows: [] },
    registrations: { rows: [{ id: 'reg-blue', status: 'confirmed' }] },
  });
  const forfeits = { createForfeit: vi.fn().mockResolvedValue(undefined) };
  const scoring = { recomputeMatchScore: vi.fn().mockResolvedValue(undefined) };
  const service = new PenaltiesService(
    db as never,
    scoring as never,
    undefined,
    undefined,
    forfeits as never,
  );
  const send = (card: Record<string, unknown>) =>
    service.createPenalty(
      'm1',
      {
        clientUuid: 'card-uuid',
        sequence: 1,
        registrationId: 'reg-blue',
        occurredAt: '2026-10-18T10:00:00.000Z',
        ...card,
      } as never,
      { staffAccountId: 'staff-1' },
    );
  return { db, forfeits, send };
}

const ENTRY_CARD = { rulesetEntryId: 'entry-1' };
const BLACK_CARD = { directCard: 'black', reason: 'dangerous action' };
/** A yellow of group 3 the Fighter took in another bout of the Tournament. */
const EARLIER_YELLOW = {
  id: 'card-earlier',
  client_uuid: 'earlier-uuid',
  match_id: 'm7',
  tournament_id: 'tournament-1',
  registration_id: 'reg-blue',
  source: 'ruleset',
  group_number: 3,
  card: 'yellow',
  voided: false,
};

describe('a card on a bout is priced by the card rules its copy pins', () => {
  it('a yellow costs what the bout started under, though the Tournament now pins other rules', async () => {
    const { db, send } = bout({ copyPin: 'cards-a', tournamentPin: 'cards-b' });

    await send(ENTRY_CARD);

    const [card] = writesTo(db, 'match_penalties');
    expect(card?.row).toMatchObject({ card: 'yellow', score_delta: -1, ruleset_id: 'cards-a' });
    // A mock ignores the projection: the copy's pin is read only if the read asks for it.
    expect(selectsFor(db.from, 'matches')[0]).toBe(
      'id, status, red_registration_id, blue_registration_id, phase_id, locked_at, current_round, awaiting_round_advance, match_rules(penalty_ruleset_id)',
    );
  });

  it('a second offence climbs the ladder the bout started under, not the Tournament’s of now', async () => {
    // Rules A count the offences of this bout; rules B count the whole Tournament's.
    const { db, send } = bout({
      copyPin: 'cards-a',
      tournamentPin: 'cards-b',
      cards: [EARLIER_YELLOW],
    });

    await send(ENTRY_CARD);

    expect(writesTo(db, 'match_penalties')[0]?.row).toMatchObject({
      card: 'yellow',
      score_delta: -1,
    });
  });

  it('a copy that pins nothing is priced by the built-in, whatever the Tournament pins now', async () => {
    const { db, send } = bout({ copyPin: null, tournamentPin: 'cards-b' });

    await send(ENTRY_CARD);

    expect(writesTo(db, 'match_penalties')[0]?.row).toMatchObject({
      card: 'yellow',
      score_delta: -5,
      ruleset_id: 'built-in',
    });
  });
});

/** `db` answers the read of `columns` from `table` with a failure, every other read as seeded. */
function failRead(db: ReturnType<typeof bout>['db'], table: string, columns: string) {
  const from = db.from.getMockImplementation()!;
  db.from.mockImplementation((name: string) => {
    const chain = from(name);
    if (name !== table) return chain;
    const select = chain.select;
    chain.select = vi.fn((asked: string, ...rest: unknown[]) =>
      asked === columns
        ? supabaseChain({ data: null, error: { message: 'down' } })
        : select(asked, ...rest),
    );
    return chain;
  });
}

const PRICE_COLUMNS =
  'id, yellow_card_points, red_card_points, black_card_points, first_black_card_forfeit, second_black_card_forfeit';

describe('a card whose rules cannot be read is an error, never a default', () => {
  // Before the card is written: written first, a black card would stand with no forfeit, and the
  // tablet's resend answers the saved card and creates none.
  it.each<[string, string, string, Partial<Story>, string]>([
    [
      'the Tournament pin',
      'tournaments',
      'penalty_ruleset_id, event_id',
      {},
      'card rules of tournament-1',
    ],
    [
      'the Event pin',
      'events',
      'penalty_ruleset_id',
      { tournamentPin: null },
      'card rules of event-1',
    ],
    ['the built-in', 'penalty_rulesets', 'id', { tournamentPin: null }, 'built-in card rules'],
  ])(
    'a black card whose reach (%s) cannot be read is refused before it is written',
    async (_what, table, columns, story, message) => {
      const { db, forfeits, send } = bout({
        copyPin: 'cards-b',
        tournamentPin: 'cards-b',
        ...story,
      });
      failRead(db, table, columns);

      await expect(send(BLACK_CARD)).rejects.toThrow(`The ${message} were not read`);
      expect(writesTo(db, 'match_penalties')).toEqual([]);
      expect(forfeits.createForfeit).not.toHaveBeenCalled();
    },
  );

  it('a card whose price cannot be read is refused before it is written', async () => {
    const { db, send } = bout({ copyPin: 'cards-b', tournamentPin: 'cards-b' });
    failRead(db, 'penalty_rulesets', PRICE_COLUMNS);

    await expect(send({ directCard: 'yellow', reason: 'delay' })).rejects.toThrow(
      'Card rules cards-b were not read: down',
    );
    expect(writesTo(db, 'match_penalties')).toEqual([]);
  });

  it('a black card that cannot be counted is an error, not a first black card', async () => {
    const { db, forfeits, send } = bout({ copyPin: 'cards-b', tournamentPin: 'cards-b' });
    failRead(db, 'match_penalties', 'id');

    await expect(send(BLACK_CARD)).rejects.toThrow(
      'The black cards of reg-blue were not counted: down',
    );
    expect(forfeits.createForfeit).not.toHaveBeenCalled();
  });
});

describe('how far a black card reaches is the Tournament’s of now', () => {
  it('card rules the Tournament moved to since put the Fighter out, as its forfeit does', async () => {
    // The copy's rules B say the bout only; the Tournament's rules A say out.
    const { db, forfeits, send } = bout({ copyPin: 'cards-b', tournamentPin: 'cards-a' });

    await send(BLACK_CARD);

    expect(writesTo(db, 'registrations')[0]?.row).toEqual({ status: 'disqualified' });
    expect(forfeits.createForfeit).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ forfeitingRegistrationId: 'reg-blue', reason: 'black_card_1' }),
      { staffAccountId: 'staff-1' },
      undefined,
      'tournament',
    );
  });

  it('the Tournament’s card rules of now keep a first black card to the bout', async () => {
    // The copy's rules A would put the Fighter out; the Tournament's rules B say the bout only.
    const { db, forfeits, send } = bout({ copyPin: 'cards-a', tournamentPin: 'cards-b' });

    await send(BLACK_CARD);

    expect(forfeits.createForfeit).toHaveBeenCalledTimes(1);
    expect(writesTo(db, 'registrations')).toEqual([]);
  });

  it('a forfeit policy the scoring rules still hold does not reach a black card', async () => {
    // Before ruling 54 a stored "withdrawn" beat the card rules B, which say the bout only.
    const reasons = { black_card_1: { tournamentState: 'withdrawn' } };
    const rulesetConfig = { forfeitPolicy: { reasons } };
    const { db, send } = bout({ copyPin: 'cards-b', tournamentPin: 'cards-b', rulesetConfig });

    await send(BLACK_CARD);

    expect(writesTo(db, 'registrations')).toEqual([]);
  });

  it('the same black card sent again puts the Fighter out again, as its first send did', async () => {
    // The copy's rules B say the bout only, the Tournament's A say out.
    const story = { copyPin: 'cards-b', tournamentPin: 'cards-a' };
    const first = bout(story);
    await first.send(BLACK_CARD);
    const saved = {
      id: 'card-new',
      client_uuid: 'card-uuid',
      match_id: 'm1',
      tournament_id: 'tournament-1',
      registration_id: 'reg-blue',
      card: 'black',
      voided: false,
      causes_match_forfeit: true,
    };
    const again = bout({ ...story, cards: [saved] });

    await expect(again.send(BLACK_CARD)).resolves.toBe(saved);

    expect(writesTo(first.db, 'registrations')[0]?.row).toEqual({ status: 'disqualified' });
    expect(writesTo(again.db, 'match_penalties')).toEqual([]);
    expect(writesTo(again.db, 'registrations').map((write) => write.row)).toEqual(
      writesTo(first.db, 'registrations').map((write) => write.row),
    );
  });
});

/** A club's card rules that no Tournament or Event pins: only a bout may hold them. */
function cardRules(seed: { held?: ChainResult; tournaments?: TableSeed; events?: TableSeed }) {
  const db = mockSupabase(
    {
      penalty_rulesets: { rows: [{ ...CARDS_A, version: '1.0.0' }] },
      tournaments: seed.tournaments ?? { rows: [] },
      events: seed.events ?? { rows: [] },
      platform_roles: { rows: [] },
    },
    { card_ruleset_held_by_a_bout: () => seed.held ?? { data: false, error: null } },
  );
  return { db, service: new PenaltiesService(db as never) };
}
const HELD = { data: true, error: null };
const RENAME = { name: 'Renamed' } as never;

describe('card rules a bout holds are not edited in place', () => {
  it.each<[string, (service: PenaltiesService) => Promise<unknown>]>([
    ['edit', (service) => service.updateRuleset('cards-a', RENAME, 'user-1')],
    ['roll back', (service) => service.rollbackRuleset('cards-a', 'ver-1', 'user-1')],
  ])('refuses to %s card rules only a bout holds', async (_door, door) => {
    const { db, service } = cardRules({ held: HELD });

    await expect(door(service)).rejects.toThrow(/in use by a tournament, an event or a bout/);
    expect(writesTo(db, 'penalty_rulesets')).toEqual([]);
    // The keys are the function's own: a double cannot see a renamed one.
    const [[name, args]] = db.rpc.mock.calls as [[string, Record<string, unknown>]];
    expect(name).toBe('card_ruleset_held_by_a_bout');
    expect(args).toEqual({ p_ruleset_id: 'cards-a' });
    expect(Object.keys(args)).toEqual(lastFunctionParams('card_ruleset_held_by_a_bout'));
  });

  it('archives card rules only a bout holds instead of deleting them', async () => {
    const { db, service } = cardRules({ held: HELD });

    await expect(service.deleteRuleset('cards-a', 'user-1')).resolves.toEqual({ archived: true });
    expect(writesTo(db, 'penalty_rulesets').map((write) => write.op)).toEqual(['update']);
  });

  it('edits and deletes card rules no bout holds', async () => {
    const edited = cardRules({});
    await edited.service.updateRuleset('cards-a', RENAME, 'user-1');
    expect(writesTo(edited.db, 'penalty_rulesets')[0]?.row).toMatchObject({ name: 'Renamed' });

    const deleted = cardRules({});
    await expect(deleted.service.deleteRuleset('cards-a', 'user-1')).resolves.toEqual({
      archived: false,
    });
    expect(writesTo(deleted.db, 'penalty_rulesets').map((write) => write.op)).toEqual(['delete']);
  });

  it.each<[string, Parameters<typeof cardRules>[0], string]>([
    [
      'the Tournaments that pin them',
      { tournaments: { data: null, error: { message: 'connection reset' } } },
      'The tournaments pinning ruleset cards-a were not counted',
    ],
    [
      'the Events that pin them',
      { events: { data: null, error: { message: 'connection reset' } } },
      'The events pinning ruleset cards-a were not counted',
    ],
    [
      'the bouts that hold them',
      { held: { data: null, error: { message: 'connection reset' } } },
      'The bouts holding ruleset cards-a were not counted: connection reset',
    ],
  ])('a failed count of %s is an error, never an edit', async (_what, seed, message) => {
    const { db, service } = cardRules(seed);

    await expect(service.updateRuleset('cards-a', RENAME, 'user-1')).rejects.toThrow(message);
    expect(writesTo(db, 'penalty_rulesets')).toEqual([]);
  });
});
