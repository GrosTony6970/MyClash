import { describe, expect, it } from 'vitest';
import { CLUB_START_FORFEIT_RULES } from '@myclash/types/forfeit-rules';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { MatchForfeitsService } from './match-forfeits.service';

/**
 * "Can the Fighter continue?" is a question of the Pool and of Swiss only (operator ruling 76,
 * 2026-10-20). In a bracket, a rule that asks means the Fighter continues in the Tournament: no
 * status is written.
 *
 * The club start asks on an injury. The Tournament pins no penalty ruleset: the built-in answers.
 */

/** Red's injury bout, running, in a phase of `type`. */
function bout(type: string) {
  const db = mockSupabase({
    matches: {
      rows: [
        {
          id: 'm1',
          phase_id: 'phase-1',
          pool_id: type === 'pool' ? 'pool-1' : null,
          bracket_slot_id: null,
          status: 'running',
          red_registration_id: 'reg-red',
          blue_registration_id: 'reg-blue',
          red_score: 2,
          blue_score: 3,
          phases: { id: 'phase-1', type, tournament_id: 'tournament-1', config_json: {} },
        },
      ],
    },
    match_forfeits: {
      rows: [],
      returning: (row: Record<string, unknown>) => ({ id: `ff-${String(row['match_id'])}` }),
    },
    registrations: { rows: [{ id: 'reg-red', status: 'checked_in' }] },
    tournaments: {
      rows: [{ id: 'tournament-1', event_id: 'event-1', penalty_ruleset_id: null }],
    },
    events: { rows: [{ id: 'event-1', penalty_ruleset_id: null }] },
    penalty_rulesets: {
      rows: [
        {
          id: 'built-in',
          built_in: true,
          owner_organization_id: null,
          first_black_card_forfeit: 'match',
          second_black_card_forfeit: 'tournament',
          forfeit_rules: CLUB_START_FORFEIT_RULES,
        },
      ],
    },
  });
  const service = new MatchForfeitsService(db as never, undefined as never);
  const injured = (canContinue: boolean) =>
    service.createForfeit('m1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'injury',
      canContinue,
    } as never);
  return { db, injured };
}

const fighterStates = (db: ReturnType<typeof bout>['db']) =>
  writesTo(db, 'registrations').map((write) => write.row);
const recorded = (db: ReturnType<typeof bout>['db']) =>
  writesTo(db, 'match_forfeits')
    .filter((write) => write.op === 'insert')
    .map((write) => write.row as Record<string, unknown>);

describe('"can the Fighter continue?" is asked of the Pool and of Swiss only', () => {
  it.each(['single_elim', 'double_elim'])(
    'a %s bout ignores the answer: the Fighter is not withdrawn',
    async (type) => {
      const { db, injured } = bout(type);

      await injured(false);

      expect(fighterStates(db)).toEqual([]);
      expect(recorded(db)).toEqual([
        expect.objectContaining({ match_id: 'm1', reason: 'injury', can_continue: true }),
      ]);
    },
  );

  it.each(['pool', 'swiss'])(
    'a %s bout takes the answer: the Fighter is withdrawn',
    async (type) => {
      const { db, injured } = bout(type);

      await injured(false);

      expect(fighterStates(db)).toContainEqual({ status: 'withdrawn' });
      expect(recorded(db)[0]).toMatchObject({ match_id: 'm1', can_continue: false });
    },
  );
});
