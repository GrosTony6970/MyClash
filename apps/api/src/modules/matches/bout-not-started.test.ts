import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { PenaltiesService } from '../penalties/penalties.service';
import { MatchesService } from './matches.service';

/**
 * A hit or a card for a bout nobody has started is refused (ruling 286).
 *
 * Marc scores Anna against Ben on a pad. The wifi drops, and the pad keeps two
 * hits in its queue. At the table the bout is reset: its hits are voided and it
 * is `scheduled` again. The wifi comes back and the pad sends its two hits. The
 * server took them: the bout read "not started" at 2 to 0, and the next fight
 * began from there.
 *
 * Only `scheduled` is refused. A pad starts a bout online, so every queued hit
 * was scored on a bout the server knew as running: one that is `scheduled` now
 * was put back (a reset, the undo of an earlier bracket bout, of a forfeit). The
 * refusal is a 409 with a code: the pad holds such a hit, and the scorer sends
 * it again or discards it.
 */
const SCORER = 'a0000000-0000-4000-8000-000000000001';
const SAVED_HIT = { id: 'ex-1', client_uuid: 'uuid-saved', match_id: 'm1', sequence: 3 };
const SAVED_CARD = { id: 'card-1', client_uuid: 'uuid-saved', match_id: 'm1' };
const HIT = { sequence: 4, type: 'no_exchange', occurredAt: '2026-10-05T10:00:00.000Z' };
const CARD = {
  sequence: 4,
  registrationId: 'reg-red',
  directCard: 'yellow',
  reason: 'late on the piste',
  occurredAt: '2026-10-05T10:00:00.000Z',
};
const NOT_STARTED = new ConflictException({
  message: 'This bout is not started, or it was reset. It takes a hit or a card once it runs.',
  code: 'bout_not_started',
});

function setup(status: string) {
  const db = mockSupabase({
    exchanges: { rows: [SAVED_HIT] },
    match_penalties: { rows: [SAVED_CARD] },
    matches: {
      rows: [
        {
          id: 'm1',
          status,
          phase_id: 'phase-1',
          locked_at: null,
          red_registration_id: 'reg-red',
          blue_registration_id: 'reg-blue',
          current_round: 1,
          awaiting_round_advance: false,
        },
        // A decoy: another bout that runs must not answer for this one.
        { id: 'm2', status: 'running', phase_id: 'phase-1', locked_at: null },
      ],
    },
    phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1' }] },
    tournaments: { rows: [{ id: 'tournament-1', event_id: 'event-1', penalty_ruleset_id: null }] },
    events: { rows: [{ id: 'event-1', organization_id: 'org-1', penalty_ruleset_id: null }] },
    penalty_rulesets: { rows: [] },
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
  const hit = (clientUuid: string) =>
    matches.createExchange('m1', { ...HIT, clientUuid } as never, { userId: SCORER });
  const card = (clientUuid: string) =>
    penalties.createPenalty('m1', { ...CARD, clientUuid } as never, {
      userId: SCORER,
      staffAccountId: 'pad-1',
    });
  return { db, scoring, hit, card };
}

/** What a door answered: the row it resolved with, or what it threw. */
const answer = (attempt: Promise<unknown>) =>
  attempt.then(
    (row) => ({ row, thrown: null as unknown }),
    (thrown: unknown) => ({ row: null, thrown }),
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

    await expect(hit('uuid-saved')).resolves.toEqual(SAVED_HIT);
    expect(db.writes).toEqual([]);
  });

  it.each<'running' | 'paused' | 'completed'>(['running', 'paused', 'completed'])(
    'is taken on a %s bout',
    async (status) => {
      const { db, hit } = setup(status);

      const { thrown } = await answer(hit('uuid-new'));

      expect(thrown).not.toEqual(NOT_STARTED);
      expect(writesTo(db, 'exchanges').map((write) => write.op)).toContain('insert');
    },
  );
});

describe('a card for a bout that is not started (ruling 286)', () => {
  it('is refused with the same code, and nothing is written', async () => {
    const { db, scoring, card } = setup('scheduled');

    await expect(card('uuid-new')).rejects.toEqual(NOT_STARTED);

    expect(db.writes).toEqual([]);
    expect(scoring.recomputeMatchScore).not.toHaveBeenCalled();
    expect(selectsFor(db.from, 'matches').some((select) => /\bstatus\b/.test(select))).toBe(true);
  });

  it('a card the server holds is still answered with the saved row', async () => {
    const { db, card } = setup('scheduled');

    await expect(card('uuid-saved')).resolves.toEqual(SAVED_CARD);
    expect(db.writes).toEqual([]);
  });

  it.each<'running' | 'paused' | 'completed'>(['running', 'paused', 'completed'])(
    'is not refused for that on a %s bout',
    async (status) => {
      const { card } = setup(status);

      const { thrown } = await answer(card('uuid-new'));

      expect(thrown).not.toEqual(NOT_STARTED);
    },
  );
});
