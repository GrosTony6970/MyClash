import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { PenaltiesService } from '../penalties/penalties.service';
import { MatchesService } from './matches.service';

/**
 * What a bout takes from a pad (rulings 286, 286a, 290).
 *
 * Marc scores Anna against Ben on a pad. The wifi drops, and the pad keeps two
 * hits in its queue. At the table the bout is reset: its hits are voided and it
 * is `scheduled` again. The wifi comes back and the pad sends its two hits. The
 * server took them: the bout read "not started" at 2 to 0, and the next fight
 * began from there.
 *
 *   - 290: a hit or a card scored (the pad's time) before the bout's last reset
 *     is refused, whatever the bout reads now: started again on another tablet,
 *     it took the old hits with nobody looking.
 *   - 286: a hit, or a card of the pad's queue, for a `scheduled` bout is
 *     refused. A pad starts a bout online, so that bout was put back.
 *   - 286a: a DIRECT card is taken before the start (a Fighter late on the
 *     piste): the referee gives it at once, from the corrections drawer.
 *
 * Each is a 409 with a code: the pad holds such a hit.
 */
const SCORER = 'a0000000-0000-4000-8000-000000000001';
const RESET_AT = '2026-10-05T10:00:00.000Z';
const BEFORE = '2026-10-05T09:59:00.000Z';
const AFTER = '2026-10-05T10:01:00.000Z';
const SAVED_HIT = { id: 'ex-1', client_uuid: 'uuid-saved', match_id: 'm1', sequence: 3 };
const SAVED_CARD = { id: 'card-1', client_uuid: 'uuid-saved', match_id: 'm1' };
const HIT = { sequence: 4, type: 'no_exchange' };
const CARD = { sequence: 4, registrationId: 'reg-red', reason: 'late on the piste' };
const DIRECT = { directCard: 'yellow' };
const QUEUED = { rulesetEntryId: 'entry-1' };
const NOT_STARTED = new ConflictException({
  message: 'This bout is not started, or it was reset. It takes a hit or a card once it runs.',
  code: 'bout_not_started',
});
const BEFORE_RESET = new ConflictException({
  message: 'This was scored before the bout was reset. It belongs to the fight that was cancelled.',
  code: 'scored_before_reset',
});
const BOUT = {
  id: 'm1',
  phase_id: 'phase-1',
  locked_at: null,
  red_registration_id: 'reg-red',
  blue_registration_id: 'reg-blue',
  current_round: 1,
  awaiting_round_advance: false,
};
/** The bout was reset twice; a later reset of ANOTHER bout is a decoy. */
const RESETS = [
  { match_id: 'm1', type: 'reset_match', sequence: 4, occurred_at: '2026-10-05T08:00:00.000Z' },
  { match_id: 'm1', type: 'reset_match', sequence: 9, occurred_at: RESET_AT },
  { match_id: 'm1', type: 'start', sequence: 10, occurred_at: '2026-10-05T10:00:30.000Z' },
  { match_id: 'm2', type: 'reset_match', sequence: 2, occurred_at: '2026-10-05T12:00:00.000Z' },
];

function setup(status: string, seed: Record<string, TableSeed> = {}) {
  const db = mockSupabase({
    exchanges: { rows: [SAVED_HIT] },
    match_penalties: { rows: [SAVED_CARD] },
    matches: { rows: [{ ...BOUT, status }] },
    match_events: { rows: RESETS },
    phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1' }] },
    tournaments: { rows: [{ id: 'tournament-1', event_id: 'event-1', penalty_ruleset_id: null }] },
    events: { rows: [{ id: 'event-1', organization_id: 'org-1', penalty_ruleset_id: null }] },
    penalty_rulesets: { rows: [] },
    ...seed,
  });
  const scoring = { recomputeMatchScore: vi.fn() };
  const matches = new MatchesService(
    db as never,
    scoring as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const penalties = new PenaltiesService(db as never, scoring as never);
  const hit = (clientUuid: string, occurredAt = AFTER) =>
    matches.createExchange('m1', { ...HIT, clientUuid, occurredAt } as never);
  const card = (clientUuid: string, kind: object = QUEUED, occurredAt = AFTER) =>
    penalties.createPenalty('m1', { ...CARD, ...kind, clientUuid, occurredAt } as never, {
      userId: SCORER,
      staffAccountId: 'pad-1',
    });
  return { db, scoring, hit, card };
}

/** What a door threw, or null when it answered. */
const thrownBy = (attempt: Promise<unknown>) =>
  attempt.then(
    () => null,
    (thrown: unknown) => thrown,
  );

describe('a hit for a bout that is not started (ruling 286)', () => {
  it('is refused with a code, and nothing is written', async () => {
    const { db, scoring, hit } = setup('scheduled');

    await expect(hit('uuid-new')).rejects.toEqual(NOT_STARTED);

    expect(db.writes).toEqual([]);
    expect(scoring.recomputeMatchScore).not.toHaveBeenCalled();
    // The double ignores the projection: without the column the check reads nothing.
    expect(selectsFor(db.from, 'matches')).toContain(
      'status, current_round, awaiting_round_advance',
    );
  });

  it('a hit the server holds is still answered with the saved row', async () => {
    const { db, hit } = setup('scheduled');

    await expect(hit('uuid-saved', BEFORE)).resolves.toEqual(SAVED_HIT);
    expect(db.writes).toEqual([]);
  });

  it.each<'running' | 'paused' | 'completed'>(['running', 'paused', 'completed'])(
    'is taken on a %s bout',
    async (status) => {
      const { db, hit } = setup(status);

      expect(await thrownBy(hit('uuid-new'))).toBeNull();
      expect(writesTo(db, 'exchanges').map((write) => write.op)).toContain('insert');
    },
  );

  // "Could not read the bout" passed as "the bout takes it": the hit went in as round 1.
  it('a failed read of the bout is an error, and nothing is written', async () => {
    const { db, hit } = setup('running', {
      matches: [{ data: null, error: { message: 'the bout is away' } }],
    });

    const thrown = await thrownBy(hit('uuid-new'));

    expect(thrown).not.toBeInstanceOf(ConflictException);
    expect((thrown as Error).message).toContain('the bout is away');
    expect(db.writes).toEqual([]);
  });
});

describe('a hit scored before the bout’s last reset (ruling 290)', () => {
  it('is refused on a bout that runs again, and nothing is written', async () => {
    const { db, scoring, hit } = setup('running');

    await expect(hit('uuid-new', BEFORE)).rejects.toEqual(BEFORE_RESET);

    expect(db.writes).toEqual([]);
    expect(scoring.recomputeMatchScore).not.toHaveBeenCalled();
  });

  it('says so rather than "not started" on a bout still scheduled', async () => {
    const { hit } = setup('scheduled');

    await expect(hit('uuid-new', BEFORE)).rejects.toEqual(BEFORE_RESET);
  });

  it('a hit scored at the instant of the reset is from before it', async () => {
    const { hit } = setup('running');

    await expect(hit('uuid-new', RESET_AT)).rejects.toEqual(BEFORE_RESET);
  });

  it('reads the LAST reset of THIS bout', async () => {
    const { db, hit } = setup('running');

    // After the bout's two resets, before the other bout's: taken.
    expect(await thrownBy(hit('uuid-new', AFTER))).toBeNull();
    expect(selectsFor(db.from, 'match_events')).toEqual(['occurred_at']);
    expect(filtersFor(db.from, 'match_events', 'eq')).toEqual([
      ['match_id', 'm1'],
      ['type', 'reset_match'],
    ]);
    expect(filtersFor(db.from, 'match_events', 'order')).toEqual([
      ['sequence', { ascending: false }],
    ]);
  });

  it('a bout never reset takes a hit of any time', async () => {
    const { hit } = setup('running', { match_events: { rows: [] } });

    expect(await thrownBy(hit('uuid-new', '2020-01-01T00:00:00.000Z'))).toBeNull();
  });

  it('a failed read of the resets is an error, never "never reset"', async () => {
    const { db, hit } = setup('running', {
      match_events: [{ data: null, error: { message: 'the events are away' } }],
    });

    const thrown = await thrownBy(hit('uuid-new', BEFORE));

    expect(thrown).not.toBeInstanceOf(ConflictException);
    expect((thrown as Error).message).toContain('the events are away');
    expect(db.writes).toEqual([]);
  });
});

describe('a card and the bout it is for (rulings 286, 286a, 290)', () => {
  it('a card of the pad’s queue is refused on a bout not started', async () => {
    const { db, scoring, card } = setup('scheduled');

    await expect(card('uuid-new')).rejects.toEqual(NOT_STARTED);

    expect(db.writes).toEqual([]);
    expect(scoring.recomputeMatchScore).not.toHaveBeenCalled();
    expect(selectsFor(db.from, 'matches').some((select) => /\bstatus\b/.test(select))).toBe(true);
  });

  // Ben is late on the piste: the referee gives the card before the start.
  it('a direct card is taken on a bout not started', async () => {
    const { db, card } = setup('scheduled');

    const thrown = await thrownBy(card('uuid-new', DIRECT));

    expect(thrown).not.toBeInstanceOf(ConflictException);
    expect(writesTo(db, 'match_penalties').map((write) => write.op)).toContain('insert');
  });

  it.each<[string, object]>([
    ['of the queue', QUEUED],
    ['given at once', DIRECT],
  ])('a card %s, scored before the last reset, is refused', async (_kind, kind) => {
    const { db, card } = setup('running');

    await expect(card('uuid-new', kind, BEFORE)).rejects.toEqual(BEFORE_RESET);
    expect(db.writes).toEqual([]);
  });

  it('a card the server holds is still answered with the saved row', async () => {
    const { db, card } = setup('scheduled');

    await expect(card('uuid-saved', QUEUED, BEFORE)).resolves.toEqual(SAVED_CARD);
    expect(db.writes).toEqual([]);
  });

  it.each<'running' | 'paused' | 'completed'>(['running', 'paused', 'completed'])(
    'a card of the queue is not refused for the status on a %s bout',
    async (status) => {
      const { card } = setup(status);

      const thrown = await thrownBy(card('uuid-new'));

      expect(thrown).not.toEqual(NOT_STARTED);
      expect(thrown).not.toEqual(BEFORE_RESET);
    },
  );
});
