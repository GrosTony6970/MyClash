/**
 * The harness of the tests over what a forfeit does under its Tournament's PENALTY ruleset
 * (`match-forfeits.rules.test.ts`, `match-forfeits.draw.test.ts`): a bout of Red against Blue,
 * still running, and Red's later bout in the same Pool, under `rules` as the built-in penalty
 * ruleset's. The Tournament pins no penalty ruleset, nor does its Event: the built-in answers.
 */
import { CLUB_START_FORFEIT_RULES, type ForfeitRules } from '@myclash/types/forfeit-rules';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { fighterStatusDouble, forfeitsOver } from './fighter-status.fixtures';

const BUILT_IN = 'built-in';

/** The bout of Red against Blue in a phase of `phaseType`, and Red's later bout in the Pool. */
const boutsIn = (phaseType: string, over: Record<string, unknown>) => [
  {
    id: 'm1',
    phase_id: 'phase-1',
    pool_id: 'pool-1',
    bracket_slot_id: null,
    status: 'running',
    ...over,
    red_registration_id: 'reg-red',
    blue_registration_id: 'reg-blue',
    red_score: 2,
    blue_score: 3,
    phases: { id: 'phase-1', type: phaseType, tournament_id: 'tournament-1', config_json: {} },
  },
  {
    id: 'm2',
    pool_id: 'pool-1',
    status: 'scheduled',
    red_registration_id: 'reg-red',
    blue_registration_id: 'reg-green',
    red_score: 0,
    blue_score: 0,
  },
];

/**
 * The bouts, under `rules` as the built-in penalty ruleset's, with Red's forfeits `history`, the
 * bout's state `boutState` over its running one.
 */
export function bout(
  rules: ForfeitRules,
  history: Record<string, unknown>[] = [],
  phaseType = 'pool',
  boutState: Record<string, unknown> = {},
) {
  const db = mockSupabase({
    matches: { rows: boutsIn(phaseType, boutState) },
    match_forfeits: {
      rows: history,
      returning: (row: Record<string, unknown>) => ({ id: `ff-${String(row['match_id'])}` }),
    },
    registrations: { rows: [{ id: 'reg-red', status: 'checked_in' }] },
    // A club scoring ruleset: nothing below reads it.
    tournaments: {
      rows: [
        {
          id: 'tournament-1',
          event_id: 'event-1',
          penalty_ruleset_id: null,
          ruleset_code: 'club_formula',
        },
      ],
    },
    events: { rows: [{ id: 'event-1', penalty_ruleset_id: null }] },
    penalty_rulesets: {
      rows: [
        {
          id: BUILT_IN,
          built_in: true,
          owner_organization_id: null,
          first_black_card_forfeit: 'match',
          second_black_card_forfeit: 'tournament',
          forfeit_rules: rules,
        },
      ],
    },
  });
  const status = fighterStatusDouble(undefined, () => db.writes);
  const service = forfeitsOver(db, status);
  const forfeit = (reason: string, canContinue?: boolean) =>
    service.createForfeit('m1', {
      forfeitingRegistrationId: 'reg-red',
      reason,
      ...(canContinue === undefined ? {} : { canContinue }),
    } as never);
  return { db, forfeit, service, status };
}

type Db = ReturnType<typeof bout>['db'];

/** The forfeit records written, in order. */
export const inserted = (db: Db) =>
  writesTo(db, 'match_forfeits')
    .filter((write) => write.op === 'insert')
    .map((write) => write.row as Record<string, unknown>);

/**
 * What the forfeit record written first stored as its own effect on its Fighter. The Fighter's
 * status is the settle's, never a write of the door (probe check 16 holds what the settle answers).
 */
export const outcome = (db: Db) => inserted(db)[0]?.['fighter_outcome'];

export const fighterStates = (db: Db) => writesTo(db, 'registrations').map((write) => write.row);

/** The club start, with one reason's rule changed. */
export const withInjury = (injury: ForfeitRules['reasons']['injury']): ForfeitRules => ({
  ...CLUB_START_FORFEIT_RULES,
  reasons: { ...CLUB_START_FORFEIT_RULES.reasons, injury },
});
