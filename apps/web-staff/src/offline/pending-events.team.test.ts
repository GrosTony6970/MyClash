/**
 * A team's queued card and protest, on the pad's provisional score and chips.
 *
 * A team side has no Registration. A card placed by Registration read
 * `null === null` as "this side" and landed under both teams, or under
 * neither when the row said ''. A card is placed by its side key: the team.
 * Its price folds over the team's priors, which are of this Match only
 * (ruling 976): the server sends them so, keyed by the team.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORING_CONFIG,
  type ExistingPenaltyForSanction,
  type PenaltyCard,
} from '@myclash/types';
import type { OutboxEntry } from './db';
import { bout, ROUND_1 } from './pad-series.fixtures';
import { padSeries } from './pad-series';
import {
  cardCountFor,
  pendingRowsForMatch,
  protestCountFor,
  provisionalDeltas,
  queuedCardsFor,
} from './pending-events';

const RED = 'team-red';
const BLUE = 'team-blue';

const RULESET = {
  yellow_card_points: 0,
  red_card_points: -1,
  black_card_points: 0,
  penalty_ruleset_entries: [
    {
      id: 'entry-red',
      group_number: 1,
      ref_number: '1',
      short_name: 'Straight red',
      description: 'Always a red card',
      sanctions: ['red'] as PenaltyCard[],
    },
    {
      id: 'entry-ladder',
      group_number: 2,
      ref_number: '2',
      short_name: 'Escalates',
      description: 'Yellow, then red',
      sanctions: ['yellow', 'red'] as PenaltyCard[],
    },
  ],
};

let seq = 0;
function row(over: Partial<OutboxEntry>): OutboxEntry {
  seq += 1;
  return {
    clientUuid: `uuid-${seq}`,
    matchId: 'm-1',
    sequence: seq,
    occurredAt: `2027-06-21T10:0${seq % 10}:00.000Z`,
    createdAt: Date.now(),
    attempts: 0,
    ...over,
  };
}
const teamCard = (teamId: string, rulesetEntryId: string) =>
  row({ kind: 'penalty', teamId, rulesetEntryId });

const pending = (
  entries: OutboxEntry[],
  priors: Record<string, ExistingPenaltyForSanction[]> = { [RED]: [], [BLUE]: [] },
) =>
  pendingRowsForMatch({
    entries,
    config: DEFAULT_SCORING_CONFIG,
    serverExchanges: [],
    serverPenalties: [],
    serverProtests: [],
    pricing: { ruleset: RULESET, priors },
  });

describe("a team's queued card", () => {
  it('names its team and no Registration on its row, never an empty id', () => {
    const { penalties } = pending([teamCard(BLUE, 'entry-red')]);

    expect(penalties).toHaveLength(1);
    expect(penalties[0]).toMatchObject({ registration_id: null, team_id: BLUE, card: 'red' });
  });

  it('adds its points to its own team only on the provisional score', () => {
    const { penalties } = pending([teamCard(BLUE, 'entry-red')]);

    expect(
      provisionalDeltas({ exchanges: [], penalties, redSideId: RED, blueSideId: BLUE }),
    ).toEqual({ red: 0, blue: -1 });
  });

  it("moves only its team's numeral on the pad's round view", () => {
    const { penalties } = pending([teamCard(RED, 'entry-red')]);

    const series = padSeries(
      bout({
        bestOf: 1,
        redSideId: RED,
        blueSideId: BLUE,
        server: ROUND_1,
        queuedPenalties: penalties,
      }),
    );

    expect({ red: series.redScore, blue: series.blueScore }).toEqual({ red: -1, blue: 0 });
  });

  it("is priced from the team's own priors of this Match (ruling 976)", () => {
    // The team took a yellow in this group earlier in this Match: the ladder's next card is red.
    const priors = {
      [RED]: [{ sideId: RED, groupNumber: 2, card: 'yellow' as const, source: 'ruleset' as const }],
      [BLUE]: [],
    };
    const { penalties, unpricedCardUuids } = pending(
      [teamCard(RED, 'entry-ladder'), teamCard(BLUE, 'entry-ladder')],
      priors,
    );

    expect(unpricedCardUuids).toEqual([]);
    expect(penalties.map((p) => [p.team_id, p.card, p.score_delta])).toEqual([
      [RED, 'red', -1],
      [BLUE, 'yellow', 0],
    ]);
  });

  it('is counted on its own team’s chips, and on no other side’s', () => {
    const { penalties, unpricedCardUuids } = pending([teamCard(BLUE, 'entry-red')]);
    const chip = (sideId: string | null) =>
      cardCountFor({ server: [], pending: penalties, sideId, card: 'red' });
    const caption = (sideId: string | null) =>
      queuedCardsFor({ pending: penalties, unpricedCardUuids, sideId });

    expect([chip(BLUE), chip(RED), chip(null)]).toEqual([1, 0, 0]);
    expect(caption(BLUE)).toEqual({ priced: 1, unpriced: 0 });
    expect(caption(RED)).toEqual({ priced: 0, unpriced: 0 });
  });
});

describe('a queued card that names no side', () => {
  it('is not priced: there is no side to count its offences against', () => {
    const nobodys = row({ kind: 'penalty', rulesetEntryId: 'entry-red' });

    const { penalties, unpricedCardUuids } = pending([nobodys]);

    expect(unpricedCardUuids).toEqual([nobodys.clientUuid]);
    expect(penalties[0]).toMatchObject({ registration_id: null, team_id: null, score_delta: 0 });
  });
});

describe("a team's queued protest", () => {
  it('names its team, and counts on its own team’s chip only', () => {
    const { protests } = pending([row({ kind: 'protest', teamId: RED, cardedColor: 'red' })]);

    expect(protests[0]).toMatchObject({ registration_id: null, team_id: RED });
    expect(protestCountFor({ server: [], pending: protests, sideId: RED })).toBe(1);
    expect(protestCountFor({ server: [], pending: protests, sideId: BLUE })).toBe(0);
  });
});
