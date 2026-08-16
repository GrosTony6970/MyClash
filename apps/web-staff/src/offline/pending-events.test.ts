import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORING_CONFIG,
  type ExistingPenaltyForSanction,
  type PenaltyCard,
  type TournamentScoringConfig,
} from '@myclash/types';
import type { ExchangeRow, Penalty } from '@myclash/ui';
import {
  cardCountFor,
  pendingRowsForMatch,
  provisionalDeltas,
  queuedCardsFor,
} from './pending-events';
import type { OutboxEntry } from './db';

let seq = 0;
function queued(over: Partial<OutboxEntry>): OutboxEntry {
  seq += 1;
  return {
    clientUuid: `uuid-${seq}`,
    matchId: 'm-1',
    sequence: seq,
    type: 'clean',
    occurredAt: `2027-06-21T10:0${seq}:00.000Z`,
    firstStrikerColor: 'red',
    firstStrikeValue: 2,
    clockTimeMs: 1000,
    createdAt: Date.now(),
    attempts: 0,
    ...over,
  };
}

const map = (entries: OutboxEntry[], config: TournamentScoringConfig = DEFAULT_SCORING_CONFIG) =>
  pendingRowsForMatch({ entries, config, serverExchanges: [], serverPenalties: [] });

/**
 * A catalogue shaped like the built-in one: yellow and black cost nothing, red
 * costs a point (migration 0054 seeds exactly these). `entry-ladder` is the
 * interesting row — its sanctions escalate, which is the whole reason pricing
 * has to be a fold rather than a lookup.
 */
const RULESET = {
  yellow_card_points: 0,
  red_card_points: -1,
  black_card_points: 0,
  penalty_ruleset_entries: [
    {
      id: 'entry-red',
      group_number: 1,
      ref_number: 1,
      short_name: 'Straight red',
      description: 'Always a red card',
      sanctions: ['red'] as PenaltyCard[],
    },
    {
      id: 'entry-ladder',
      group_number: 2,
      ref_number: 2,
      short_name: 'Escalates',
      description: 'Yellow, then red',
      sanctions: ['yellow', 'red'] as PenaltyCard[],
    },
  ],
};

const NO_PRIORS: Record<string, ExistingPenaltyForSanction[]> = { 'reg-red': [], 'reg-blue': [] };

/** Map with a full catalogue and empty priors — the ordinary online case. */
const priced = (
  entries: OutboxEntry[],
  priors: Record<string, ExistingPenaltyForSanction[]> | null = NO_PRIORS,
) =>
  pendingRowsForMatch({
    entries,
    config: DEFAULT_SCORING_CONFIG,
    serverExchanges: [],
    serverPenalties: [],
    pricing: { ruleset: RULESET, priors },
  });

describe('pendingRowsForMatch', () => {
  it('marks every row pending and keeps the client uuid as its id', () => {
    const { exchanges } = map([queued({ clientUuid: 'abc' })]);
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]!.pending).toBe(true);
    expect(exchanges[0]!.id).toBe('abc');
    expect(exchanges[0]!.client_uuid).toBe('abc');
  });

  it('carries occurredAt, without which the newest hit sorts to #1', () => {
    const { exchanges } = map([queued({ occurredAt: '2027-06-21T11:30:00.000Z' })]);
    expect(exchanges[0]!.occurredAt).toBe('2027-06-21T11:30:00.000Z');
  });

  it('gives a clean hit the button value it was scored with', () => {
    const { exchanges } = map([queued({ type: 'clean', firstStrikeValue: 3 })]);
    expect(exchanges[0]!.scoreDelta).toBe(3);
    expect(exchanges[0]!.scoringSide).toBe('red');
  });

  /**
   * SEED, DON'T RESOLVE. The raw button values are what the outbox holds — the
   * server nets them under the tournament's mode at read, which is why offline
   * scoring works on a ruleset the pad never resolved. `computeAfterblowDeltas`
   * is the same call `ScoringColumn` already makes to label the button, so the
   * provisional row agrees with what will land.
   */
  it('nets an afterblow the way the tournament’s mode will', () => {
    const deductive = map([queued({ type: 'afterblow', firstStrikeValue: 2, afterblowValue: 1 })])
      .exchanges[0]!;
    expect(deductive.scoreDelta).toBe(1);
    expect(deductive.defenderDelta).toBe(0);

    const full = map([queued({ type: 'afterblow', firstStrikeValue: 2, afterblowValue: 1 })], {
      ...DEFAULT_SCORING_CONFIG,
      afterblowMode: 'full',
    }).exchanges[0]!;
    expect(full.scoreDelta).toBe(2);
    expect(full.defenderDelta).toBe(1);
  });

  it('claims no points for a double or a no-exchange', () => {
    const { exchanges } = map([
      queued({ type: 'double', firstStrikerColor: undefined, firstStrikeValue: undefined }),
      queued({ type: 'no_exchange', firstStrikerColor: undefined, noExchangeReason: 'other' }),
    ]);
    expect(exchanges.map((e) => e.scoreDelta)).toEqual([null, null]);
  });

  it('routes a queued card to the penalty list, claiming no points without a catalogue', () => {
    const { exchanges, penalties, unpricedCardUuids } = map([
      queued({ kind: 'penalty', registrationId: 'reg-red', rulesetEntryId: 'entry-1' }),
    ]);
    expect(exchanges).toEqual([]);
    expect(penalties).toHaveLength(1);
    expect(penalties[0]!.pending).toBe(true);
    expect(penalties[0]!.score_delta).toBe(0);
    expect(penalties[0]!.registration_id).toBe('reg-red');
    expect(unpricedCardUuids).toHaveLength(1);
  });

  it('reads a v2 row with no kind as an exchange', () => {
    // Rows written before the outbox learned about penalties have no `kind`,
    // and a referee upgrades mid-event with a queue on disk.
    const { exchanges } = map([queued({ kind: undefined })]);
    expect(exchanges).toHaveLength(1);
  });

  /**
   * THE DEDUPE, and it is not optional. Between a successful POST and
   * `markSynced` committing, a row is on the server AND still in the outbox.
   * Rendering both shows one hit twice and can read the double count as 2/4
   * when it is 1/4 — a rule the referee acts on.
   */
  it('drops a queued row the server has already accepted', () => {
    const entry = queued({ clientUuid: 'shared-uuid' });
    const onServer = {
      id: 'server-id',
      client_uuid: 'shared-uuid',
      sequence: 1,
      type: 'clean',
      voided: false,
      occurredAt: entry.occurredAt,
    } satisfies ExchangeRow;

    const out = pendingRowsForMatch({
      entries: [entry],
      config: DEFAULT_SCORING_CONFIG,
      serverExchanges: [onServer],
      serverPenalties: [],
    });

    expect(out.exchanges).toEqual([]);
  });

  /**
   * THE SERVER ROW'S `id` IS NOT THE CLIENT UUID, and this test used to pretend
   * it was — it set `id: 'card-uuid'` to match the outbox row's `clientUuid`,
   * which is the one arrangement under which keying the dedupe on `id` works.
   * A fixture built from the thing under test cannot falsify it, and this one
   * stayed green over a dedupe that had never matched a real row in its life.
   *
   * `match_penalties` has `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` beside
   * `client_uuid UUID NOT NULL UNIQUE` (migration 0016), so the fixture now
   * carries two different values, as the wire does.
   */
  it('drops a queued card the server has already accepted', () => {
    const entry = queued({ kind: 'penalty', clientUuid: 'card-uuid', registrationId: 'reg-red' });
    const onServer = {
      id: 'server-generated-id',
      client_uuid: 'card-uuid',
      sequence: 1,
      registration_id: 'reg-red',
      card: 'yellow',
      source: 'ruleset',
      short_name: null,
      reason: null,
      score_delta: 0,
      causes_match_forfeit: false,
      voided: false,
    } satisfies Penalty;

    const out = pendingRowsForMatch({
      entries: [entry],
      config: DEFAULT_SCORING_CONFIG,
      serverExchanges: [],
      serverPenalties: [onServer],
    });

    expect(out.penalties).toEqual([]);
  });

  it('keeps a queued card the server has not seen', () => {
    const out = pendingRowsForMatch({
      entries: [queued({ kind: 'penalty', clientUuid: 'mine', registrationId: 'reg-red' })],
      config: DEFAULT_SCORING_CONFIG,
      serverExchanges: [],
      serverPenalties: [
        {
          id: 'server-generated-id',
          client_uuid: 'someone-elses',
          sequence: 1,
          registration_id: 'reg-blue',
          card: 'yellow',
          source: 'ruleset',
          short_name: null,
          reason: null,
          score_delta: 0,
          causes_match_forfeit: false,
          voided: false,
        } satisfies Penalty,
      ],
    });
    expect(out.penalties).toHaveLength(1);
  });

  it('keeps a queued row the server has not seen', () => {
    const out = pendingRowsForMatch({
      entries: [queued({ clientUuid: 'mine' })],
      config: DEFAULT_SCORING_CONFIG,
      serverExchanges: [
        {
          id: 'other',
          client_uuid: 'someone-elses',
          sequence: 1,
          type: 'clean',
          voided: false,
          occurredAt: '2027-06-21T09:00:00.000Z',
        },
      ],
      serverPenalties: [],
    });
    expect(out.exchanges).toHaveLength(1);
  });
});

describe('pricing a queued card', () => {
  it('prices a ruleset card from the catalogue’s per-card columns', () => {
    const { penalties, unpricedCardUuids } = priced([
      queued({ kind: 'penalty', registrationId: 'reg-red', rulesetEntryId: 'entry-red' }),
    ]);
    expect(penalties[0]!.card).toBe('red');
    expect(penalties[0]!.score_delta).toBe(-1);
    expect(penalties[0]!.group_number).toBe(1);
    expect(unpricedCardUuids).toEqual([]);
  });

  /**
   * THE FOLD. `computePenaltySanction` escalates on prior offences in the same
   * rule group, so two cards queued off one entry are not independent — the
   * second is the fighter's SECOND offence and takes the second sanction.
   * Pricing each row against the untouched server priors would call both
   * yellow, and the referee would watch a red card score nothing.
   */
  it('escalates a second queued card in the same rule group', () => {
    const { penalties } = priced([
      queued({ kind: 'penalty', registrationId: 'reg-red', rulesetEntryId: 'entry-ladder' }),
      queued({ kind: 'penalty', registrationId: 'reg-red', rulesetEntryId: 'entry-ladder' }),
    ]);
    expect(penalties.map((p) => [p.card, p.score_delta])).toEqual([
      ['yellow', 0],
      ['red', -1],
    ]);
  });

  it('does not escalate the other fighter’s card', () => {
    const { penalties } = priced([
      queued({ kind: 'penalty', registrationId: 'reg-red', rulesetEntryId: 'entry-ladder' }),
      queued({ kind: 'penalty', registrationId: 'reg-blue', rulesetEntryId: 'entry-ladder' }),
    ]);
    expect(penalties.map((p) => p.card)).toEqual(['yellow', 'yellow']);
  });

  it('counts the offences the server already knows about', () => {
    const { penalties } = priced(
      [queued({ kind: 'penalty', registrationId: 'reg-red', rulesetEntryId: 'entry-ladder' })],
      {
        'reg-red': [
          { registrationId: 'reg-red', groupNumber: 2, card: 'yellow', source: 'ruleset' },
        ],
        'reg-blue': [],
      },
    );
    expect(penalties[0]!.card).toBe('red');
  });

  /**
   * A DIRECT card is the referee overriding the catalogue. The server writes it
   * `source: 'direct'` with a null group and excludes it from the ladder, so
   * folding one in would escalate the next ruleset card off a card that does
   * not count.
   */
  it('prices a direct card without folding it into the ladder', () => {
    const { penalties } = priced([
      queued({
        kind: 'penalty',
        registrationId: 'reg-red',
        directCard: 'red',
        reason: 'Unsporting',
      }),
      queued({ kind: 'penalty', registrationId: 'reg-red', rulesetEntryId: 'entry-ladder' }),
    ]);
    expect(penalties.map((p) => [p.source, p.card, p.score_delta])).toEqual([
      ['direct', 'red', -1],
      ['ruleset', 'yellow', 0],
    ]);
  });

  /**
   * The scope read is the ONLY one of the pad's three penalty fetches that is
   * not @Public() — it runs authorizeMatchScoring — so a lapsed session leaves
   * the catalogue loaded and the priors null indefinitely. `resolveEntryCard`
   * degrades to the first-occurrence card in that case, which is the right
   * trade for labelling a button and the wrong one for a score: it would claim
   * yellow (0) on an offence the server prices red (−1).
   */
  it('refuses to price when the priors never loaded', () => {
    const { penalties, unpricedCardUuids } = priced(
      [queued({ kind: 'penalty', registrationId: 'reg-red', rulesetEntryId: 'entry-ladder' })],
      null,
    );
    expect(penalties[0]!.score_delta).toBe(0);
    expect(unpricedCardUuids).toHaveLength(1);
  });

  it('refuses to price an entry the catalogue does not have', () => {
    const { penalties, unpricedCardUuids } = priced([
      queued({ kind: 'penalty', registrationId: 'reg-red', rulesetEntryId: 'entry-gone' }),
    ]);
    expect(penalties[0]!.score_delta).toBe(0);
    expect(unpricedCardUuids).toHaveLength(1);
  });

  /**
   * With no ruleset the server falls back to `penaltyScoreDelta`, not to zero.
   * A direct card names its own colour, so the pad can follow it there.
   */
  it('prices a direct card from the built-in default when there is no ruleset', () => {
    const { penalties, unpricedCardUuids } = map([
      queued({ kind: 'penalty', registrationId: 'reg-red', directCard: 'red', reason: 'x' }),
    ]);
    expect(penalties[0]!.score_delta).toBe(-1);
    expect(unpricedCardUuids).toEqual([]);
  });

  /**
   * The dedupe runs first for a reason: a card in the window between a
   * successful POST and `markSynced` is in the outbox AND in the priors, and
   * pricing it again would make the NEXT card in its group look like a third
   * offence.
   */
  it('does not let an already-synced card escalate the next one', () => {
    const first = queued({
      kind: 'penalty',
      clientUuid: 'card-1',
      registrationId: 'reg-red',
      rulesetEntryId: 'entry-ladder',
    });
    const second = queued({
      kind: 'penalty',
      clientUuid: 'card-2',
      registrationId: 'reg-red',
      rulesetEntryId: 'entry-ladder',
    });
    const out = pendingRowsForMatch({
      entries: [first, second],
      config: DEFAULT_SCORING_CONFIG,
      serverExchanges: [],
      // The first card landed; the server counted it and the priors say so.
      serverPenalties: [
        {
          id: 'server-generated-id',
          client_uuid: 'card-1',
          sequence: first.sequence,
          registration_id: 'reg-red',
          card: 'yellow',
          source: 'ruleset',
          short_name: null,
          reason: null,
          score_delta: 0,
          causes_match_forfeit: false,
          voided: false,
        } satisfies Penalty,
      ],
      pricing: {
        ruleset: RULESET,
        priors: {
          'reg-red': [
            { registrationId: 'reg-red', groupNumber: 2, card: 'yellow', source: 'ruleset' },
          ],
          'reg-blue': [],
        },
      },
    });
    // Second offence, not third — and the third sanction does not exist.
    expect(out.penalties.map((p) => [p.card, p.score_delta])).toEqual([['red', -1]]);
  });

  it('never claims a queued card ends the match', () => {
    const { penalties } = priced([
      queued({ kind: 'penalty', registrationId: 'reg-red', directCard: 'black', reason: 'x' }),
    ]);
    expect(penalties[0]!.card).toBe('black');
    expect(penalties[0]!.causes_match_forfeit).toBe(false);
  });
});

describe('card counts', () => {
  const serverCard = (over: Partial<Penalty>): Penalty => ({
    id: 'server-generated-id',
    client_uuid: 'server-card',
    sequence: 1,
    registration_id: 'reg-red',
    card: 'yellow',
    source: 'ruleset',
    short_name: null,
    reason: null,
    score_delta: 0,
    causes_match_forfeit: false,
    voided: false,
    ...over,
  });

  /**
   * The chip read the server only, so offline it froze while the referee kept
   * carding. It is the counter they check before deciding whether the next
   * offence in the group escalates.
   */
  it('counts a queued card on the chip alongside the server’s', () => {
    const { penalties } = priced([
      queued({ kind: 'penalty', registrationId: 'reg-red', rulesetEntryId: 'entry-ladder' }),
    ]);
    expect(
      cardCountFor({
        server: [serverCard({ card: 'yellow' })],
        pending: penalties,
        registrationId: 'reg-red',
        card: 'yellow',
      }),
    ).toBe(2);
  });

  it('keeps the other fighter’s chip out of it', () => {
    const { penalties } = priced([
      queued({ kind: 'penalty', registrationId: 'reg-red', rulesetEntryId: 'entry-ladder' }),
    ]);
    expect(
      cardCountFor({ server: [], pending: penalties, registrationId: 'reg-blue', card: 'yellow' }),
    ).toBe(0);
  });

  it('puts a queued card on the chip for the colour it will ACTUALLY be', () => {
    // Second offence in the group → red, not the entry's first sanction.
    const { penalties } = priced(
      [queued({ kind: 'penalty', registrationId: 'reg-red', rulesetEntryId: 'entry-ladder' })],
      {
        'reg-red': [
          { registrationId: 'reg-red', groupNumber: 2, card: 'yellow', source: 'ruleset' },
        ],
        'reg-blue': [],
      },
    );
    const chip = (card: PenaltyCard) =>
      cardCountFor({ server: [], pending: penalties, registrationId: 'reg-red', card });
    expect({ yellow: chip('yellow'), red: chip('red') }).toEqual({ yellow: 0, red: 1 });
  });

  it('ignores a voided server card', () => {
    expect(
      cardCountFor({
        server: [serverCard({ voided: true })],
        pending: [],
        registrationId: 'reg-red',
        card: 'yellow',
      }),
    ).toBe(0);
  });

  /**
   * "Priced" is not "worth something". A yellow costs nothing under the
   * built-in rulebook and is still fully accounted for — it belongs in the
   * line that says the card is included, not the one that admits ignorance.
   */
  it('calls a priced zero-point card included, not excluded', () => {
    const { penalties, unpricedCardUuids } = priced([
      queued({ kind: 'penalty', registrationId: 'reg-red', rulesetEntryId: 'entry-ladder' }),
    ]);
    expect(
      queuedCardsFor({ pending: penalties, unpricedCardUuids, registrationId: 'reg-red' }),
    ).toEqual({ priced: 1, unpriced: 0 });
  });

  it('splits priced from unpriced for the fighter they are against', () => {
    const { penalties, unpricedCardUuids } = priced([
      queued({ kind: 'penalty', registrationId: 'reg-red', rulesetEntryId: 'entry-red' }),
      queued({ kind: 'penalty', registrationId: 'reg-red', rulesetEntryId: 'entry-gone' }),
      queued({ kind: 'penalty', registrationId: 'reg-blue', rulesetEntryId: 'entry-red' }),
    ]);
    const forSide = (registrationId: string) =>
      queuedCardsFor({ pending: penalties, unpricedCardUuids, registrationId });
    expect(forSide('reg-red')).toEqual({ priced: 1, unpriced: 1 });
    // The count this replaced was the whole match's, so blue used to be told
    // about red's unpriced card.
    expect(forSide('reg-blue')).toEqual({ priced: 1, unpriced: 0 });
  });
});

describe('provisionalDeltas', () => {
  const deltas = (over: Partial<Parameters<typeof provisionalDeltas>[0]>) =>
    provisionalDeltas({
      exchanges: [],
      penalties: [],
      redRegistrationId: 'reg-red',
      blueRegistrationId: 'reg-blue',
      ...over,
    });

  it('sums each side’s queued points', () => {
    const { exchanges } = map([
      queued({ firstStrikerColor: 'red', firstStrikeValue: 2 }),
      queued({ firstStrikerColor: 'blue', firstStrikeValue: 1 }),
      queued({ firstStrikerColor: 'red', firstStrikeValue: 3 }),
    ]);
    expect(deltas({ exchanges })).toEqual({ red: 5, blue: 1 });
  });

  it('gives the defender their points in full-afterblow mode', () => {
    const { exchanges } = map(
      [
        queued({
          type: 'afterblow',
          firstStrikerColor: 'red',
          firstStrikeValue: 2,
          afterblowValue: 1,
        }),
      ],
      { ...DEFAULT_SCORING_CONFIG, afterblowMode: 'full' },
    );
    expect(deltas({ exchanges })).toEqual({ red: 2, blue: 1 });
  });

  it('adds nothing for a double', () => {
    const { exchanges } = map([queued({ type: 'double', firstStrikerColor: undefined })]);
    expect(deltas({ exchanges })).toEqual({ red: 0, blue: 0 });
  });

  it('is zero on an empty queue', () => {
    expect(deltas({})).toEqual({ red: 0, blue: 0 });
  });

  /**
   * A card's points land on the CARDED fighter, negative in the usual case —
   * the same arithmetic `recomputeMatchScore` does server-side. Getting the
   * side wrong here would move the wrong numeral, which reads as the opponent
   * scoring.
   */
  it('takes a card’s points off the fighter who was carded', () => {
    const { penalties } = priced([
      queued({ kind: 'penalty', registrationId: 'reg-blue', rulesetEntryId: 'entry-red' }),
    ]);
    expect(deltas({ penalties })).toEqual({ red: 0, blue: -1 });
  });

  it('counts hits and cards together', () => {
    const { exchanges, penalties } = priced([
      queued({ firstStrikerColor: 'red', firstStrikeValue: 2 }),
      queued({ kind: 'penalty', registrationId: 'reg-red', rulesetEntryId: 'entry-red' }),
    ]);
    expect(deltas({ exchanges, penalties })).toEqual({ red: 1, blue: 0 });
  });

  it('ignores a voided card', () => {
    expect(
      deltas({
        penalties: [
          {
            id: 'p1',
            sequence: 1,
            registration_id: 'reg-red',
            card: 'red',
            source: 'ruleset',
            short_name: null,
            reason: null,
            score_delta: -1,
            causes_match_forfeit: false,
            voided: true,
          } satisfies Penalty,
        ],
      }),
    ).toEqual({ red: 0, blue: 0 });
  });
});
