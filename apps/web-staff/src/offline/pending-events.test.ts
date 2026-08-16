import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_CONFIG, type TournamentScoringConfig } from '@myclash/types';
import type { ExchangeRow, Penalty } from '@myclash/ui';
import { pendingRowsForMatch, provisionalDeltas } from './pending-events';
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

  it('routes a queued card to the penalty list, claiming no points', () => {
    const { exchanges, penalties } = map([
      queued({ kind: 'penalty', registrationId: 'reg-red', rulesetEntryId: 'entry-1' }),
    ]);
    expect(exchanges).toEqual([]);
    expect(penalties).toHaveLength(1);
    expect(penalties[0]!.pending).toBe(true);
    expect(penalties[0]!.score_delta).toBe(0);
    expect(penalties[0]!.registration_id).toBe('reg-red');
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

describe('provisionalDeltas', () => {
  it('sums each side’s queued points', () => {
    const { exchanges } = map([
      queued({ firstStrikerColor: 'red', firstStrikeValue: 2 }),
      queued({ firstStrikerColor: 'blue', firstStrikeValue: 1 }),
      queued({ firstStrikerColor: 'red', firstStrikeValue: 3 }),
    ]);
    expect(provisionalDeltas(exchanges)).toEqual({ red: 5, blue: 1 });
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
    expect(provisionalDeltas(exchanges)).toEqual({ red: 2, blue: 1 });
  });

  it('adds nothing for a double', () => {
    const { exchanges } = map([queued({ type: 'double', firstStrikerColor: undefined })]);
    expect(provisionalDeltas(exchanges)).toEqual({ red: 0, blue: 0 });
  });

  it('is zero on an empty queue', () => {
    expect(provisionalDeltas([])).toEqual({ red: 0, blue: 0 });
  });
});
