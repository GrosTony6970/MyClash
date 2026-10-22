/**
 * A forfeit that counts as a draw (rulings 64, 71, 72): on a Pool or Swiss bout it is saved 0-0
 * with no winner, the way a double-hit ceiling draw is, so every reader of a finished bout counts
 * it as a draw for both Fighters. The Pool bouts a withdrawal forfeits with it are draws too. A
 * bracket bout has no draw: the reason counts as its 0-X loss there.
 *
 * The story: Red is injured in a Pool bout against Blue, and the club's penalty ruleset says an
 * injury counts as a draw. Neither Fighter wins it; Red's later Pool bout, forfeited by the
 * withdrawal, is a draw too.
 */
import { describe, expect, it, vi } from 'vitest';
import { boutOutcomes } from '@myclash/rules';
import type { ForfeitReasonRule } from '@myclash/types/forfeit-rules';
import { mockSupabase, scopedTo, writesTo } from '../../common/testing/supabase-chain';
import { MatchForfeitsService } from './match-forfeits.service';
import { bout, inserted, withInjury } from './match-forfeits.rules.fixtures';
import { withStampedRules } from '../phases/match-rules.fixtures';
import { buildSwissPlayers } from '../swiss/swiss-snapshot';
import { fighterStatusDouble } from './fighter-status.fixtures';

/** An injury counts as a draw; a loss to 6 where no draw is. */
const draw = (fighter: ForfeitReasonRule['fighter']) =>
  withInjury({ outcome: 'draw', opponentScore: 6, fighter });

const matchWrites = (db: ReturnType<typeof bout>['db']): Record<string, unknown>[] =>
  writesTo(db, 'matches').map((write) => ({
    id: scopedTo(write, 'id'),
    ...(write.row as Record<string, unknown>),
  }));

describe('a forfeit that counts as a draw', () => {
  it.each(['pool', 'swiss'])(
    'ends a %s bout 0-0 with no winner, a draw for both Fighters',
    async (phaseType) => {
      const { db, forfeit } = bout(draw('continues'), [], phaseType);

      await expect(forfeit('injury', true)).resolves.toBeDefined();

      expect(inserted(db)).toEqual([
        expect.objectContaining({
          match_id: 'm1',
          score_policy: 'draw',
          winner_registration_id: null,
          forfeiting_score: 0,
          opponent_score: 0,
        }),
      ]);
      const ended = matchWrites(db).find((write) => write.id === 'm1');
      expect(ended).toMatchObject({
        status: 'completed',
        winner_registration_id: null,
        red_score: 0,
        blue_score: 0,
        end_reason: 'forfeit',
      });
      // What the standings and the pad read off that row.
      expect(
        boutOutcomes({
          winnerRegistrationId: ended!['winner_registration_id'] as string | null,
          redRegistrationId: 'reg-red',
          blueRegistrationId: 'reg-blue',
          redScore: ended!['red_score'] as number,
          blueScore: ended!['blue_score'] as number,
          endReason: ended!['end_reason'] as string,
        }),
      ).toEqual({ red: 'draw', blue: 'draw' });
    },
  );

  it('gives each Fighter a draw’s Swiss points', async () => {
    const { db, forfeit } = bout(draw('continues'), [], 'swiss');
    await expect(forfeit('injury', true)).resolves.toBeDefined();
    const ended = matchWrites(db).find((write) => write.id === 'm1')!;

    // The Swiss standings' and pairing's own reader, with a MARKER draw value.
    const players = buildSwissPlayers(
      [
        { registrationId: 'reg-red', withdrawnAtRound: null, missedRounds: [] },
        { registrationId: 'reg-blue', withdrawnAtRound: null, missedRounds: [] },
      ],
      [
        {
          id: 'round-1',
          roundNumber: 1,
          status: 'completed',
          byeRegistrationId: null,
          pairingMeta: null,
          matches: [
            {
              id: 'm1',
              redRegistrationId: 'reg-red',
              blueRegistrationId: 'reg-blue',
              winnerRegistrationId: ended['winner_registration_id'] as string | null,
              status: ended['status'] as string,
              endReason: ended['end_reason'] as string,
            },
          ],
        },
      ],
      { win: 3, draw: 7, loss: 0, bye: 3 },
    );

    expect(players.map((player) => player.points)).toEqual([7, 7]);
  });

  it('counts as its 0-X loss on a bracket bout, which has no draw', async () => {
    const { db, forfeit } = bout(draw('continues'), [], 'single_elim');

    await expect(forfeit('injury', true)).resolves.toBeDefined();

    expect(inserted(db)).toEqual([
      expect.objectContaining({
        score_policy: 'fixed_loss',
        winner_registration_id: 'reg-blue',
        forfeiting_score: 0,
        opponent_score: 6,
      }),
    ]);
    expect(matchWrites(db).find((write) => write.id === 'm1')).toMatchObject({
      winner_registration_id: 'reg-blue',
      red_score: 0,
      blue_score: 6,
    });
  });

  // Ruling 71's later Pool bouts follow her status: the reconcile scores them by this reason
  // (`fighter-reconcile.out.test.ts`, "a withdrawal whose reason draws").
  it('a withdrawal that draws is a draw on its own bout, and withdraws her', async () => {
    const { db, forfeit } = bout(draw('withdrawn'));

    await expect(forfeit('injury')).resolves.toBeDefined();

    expect(inserted(db)).toEqual([
      expect.objectContaining({
        match_id: 'm1',
        score_policy: 'draw',
        winner_registration_id: null,
        fighter_outcome: 'withdrawn',
      }),
    ]);
  });
});

describe('a forfeit draw taken back', () => {
  const DRAWN = {
    status: 'completed',
    red_score: 0,
    blue_score: 0,
    winner_registration_id: null,
    ended_at: '2026-01-01T00:05:00Z',
    end_reason: 'forfeit',
  };
  const RUNNING = { status: 'running', red_score: 2, blue_score: 3, winner_registration_id: null };

  it('puts the bout back as the forfeit found it', async () => {
    const db = mockSupabase(
      ...withStampedRules({
        matches: {
          rows: [
            {
              id: 'm1',
              red_registration_id: 'reg-red',
              blue_registration_id: 'reg-blue',
              locked_at: null,
              phases: { type: 'pool', tournament_id: 't-1', tournaments: null },
              ...DRAWN,
            },
          ],
        },
        match_forfeits: {
          rows: [
            {
              id: 'ff-1',
              match_id: 'm1',
              parent_forfeit_id: null,
              forfeiting_registration_id: 'reg-red',
              winner_registration_id: null,
              score_policy: 'draw',
              downstream_match_ids: [],
              voided_at: null,
              previous_match_state: RUNNING,
              resulting_match_state: DRAWN,
            },
          ],
        },
        exchanges: { rows: [] },
        match_penalties: { rows: [] },
      }),
    );
    const none = undefined as never;
    const service = new MatchForfeitsService(
      db as never,
      none,
      none,
      { clearDownstreamOf: vi.fn() } as never,
      none,
      { recomputeMatchScore: vi.fn() } as never,
      fighterStatusDouble(),
    );

    await service.voidForfeit('ff-1');

    expect(matchWrites(db).find((write) => write.id === 'm1')).toMatchObject({
      status: 'running',
      red_score: 2,
      blue_score: 3,
      winner_registration_id: null,
    });
    expect(writesTo(db, 'match_forfeits').map((write) => write.row)).toContainEqual(
      expect.objectContaining({ voided_at: expect.any(String) }),
    );
  });
});
