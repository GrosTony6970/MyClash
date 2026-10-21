import { describe, expect, it } from 'vitest';
import {
  CLUB_START_FORFEIT_RULES,
  FFAMHE_FORFEIT_RULES,
  type ForfeitRules,
} from '@myclash/types/forfeit-rules';
import { selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { MatchForfeitsService } from './match-forfeits.service';
import {
  bout,
  fighterStates,
  inserted,
  outcome,
  withInjury,
} from './match-forfeits.rules.fixtures';
import { fighterStatusDouble } from './fighter-status.fixtures';

/**
 * What a forfeit does is its Tournament's PENALTY ruleset's (operator rulings 63-76, 2026-10-20):
 * per reason, what the bout counts as and what happens to the Fighter; "disqualify after N"; and
 * a black card's 0-X loss. The scoring ruleset holds none of it, so a Tournament on a club scoring
 * ruleset gets FFAMHE's "disqualify after 2" when it plays under the built-in penalty ruleset.
 *
 * The Tournament here pins no penalty ruleset, nor does its Event: the built-in answers
 * (`match-forfeits.rules.fixtures.ts`).
 */

/** A forfeit Red chose in another bout, before this one. */
const EARLIER = {
  id: 'ff-m7',
  match_id: 'm7',
  tournament_id: 'tournament-1',
  forfeiting_registration_id: 'reg-red',
  reason: 'voluntary',
  parent_forfeit_id: null,
  auto_created: false,
  under_out_status: false,
  voided_at: null,
};

describe('"disqualify after N forfeits" is the penalty ruleset’s', () => {
  // The 2nd forfeit is stored as nothing of its own: the settle counts the live ones (ruling 80,
  // probe check 16). Until the bouts follow the status (B2), the count still forfeits the Pool.
  it('FFAMHE counts the 2nd forfeit, on a club scoring ruleset too: it takes her out', async () => {
    const { db, forfeit } = bout(FFAMHE_FORFEIT_RULES, [EARLIER]);

    await forfeit('voluntary', true);

    // Her later Pool bout is the reconcile's, once the settle counts her out (B2).
    expect(inserted(db)).toEqual([
      expect.objectContaining({ match_id: 'm1', can_continue: false }),
    ]);
    expect(outcome(db)).toBeNull();
    expect(fighterStates(db)).toEqual([]);
  });

  it('a new club penalty ruleset (Off) does not', async () => {
    const { db, forfeit } = bout(CLUB_START_FORFEIT_RULES, [EARLIER]);

    await forfeit('voluntary', true);

    expect(inserted(db)).toEqual([expect.objectContaining({ match_id: 'm1', can_continue: true })]);
    expect(outcome(db)).toBeNull();
  });

  it('reads the rules off the Tournament’s penalty ruleset row', async () => {
    const { db, forfeit } = bout(CLUB_START_FORFEIT_RULES);

    await forfeit('voluntary', true);

    // A double ignores the projection: the rules are read only if the read asks for them.
    expect(selectsFor(db.from, 'penalty_rulesets').join(' | ')).toContain('forfeit_rules');
  });
});

describe('what happens to the Fighter is the reason’s rule', () => {
  it('"disqualified" disqualifies whatever the answer', async () => {
    const rules = withInjury({ outcome: 'fixed_loss', opponentScore: 6, fighter: 'disqualified' });
    const { db, forfeit } = bout(rules);

    await forfeit('injury', true);

    expect(outcome(db)).toBe('disqualified');
    expect(inserted(db).map((row) => row['match_id'])).toEqual(['m1']);
  });

  it('"continues" ignores an answer that the Fighter cannot continue', async () => {
    const rules = withInjury({ outcome: 'fixed_loss', opponentScore: 6, fighter: 'continues' });
    const { db, forfeit } = bout(rules);

    await forfeit('injury', false);

    expect(outcome(db)).toBeNull();
    expect(inserted(db)).toEqual([expect.objectContaining({ match_id: 'm1', can_continue: true })]);
  });
});

describe('the score of a forfeit loss is the penalty ruleset’s', () => {
  it('a reason’s 0-X applies on its bout (and on the bouts its withdrawal forfeits, B2)', async () => {
    const rules = withInjury({ outcome: 'fixed_loss', opponentScore: 9, fighter: 'withdrawn' });
    const { db, forfeit } = bout(rules);

    await forfeit('injury');

    // The later bouts are the reconcile's, scored by this reason (`fighter-reconcile.out.test.ts`).
    expect(inserted(db)).toEqual([
      expect.objectContaining({ match_id: 'm1', forfeiting_score: 0, opponent_score: 9 }),
    ]);
    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({ red_score: 0, blue_score: 9 });
  });

  it('a black card forfeit’s 0-X is the black card score', async () => {
    const rules = { ...CLUB_START_FORFEIT_RULES, blackCardOpponentScore: 11 };
    const { db, forfeit } = bout(rules);

    // The 2nd black card, which the built-in's column sends to the whole Tournament.
    await forfeit('black_card_2');

    expect(inserted(db)).toEqual([
      expect.objectContaining({ match_id: 'm1', opponent_score: 11, can_continue: false }),
    ]);
    expect(outcome(db)).toBe('disqualified');
  });
});

describe('stored forfeit rules that do not parse', () => {
  it('refuse a forfeit recorded by hand with a 409 that names them, and write nothing', async () => {
    const broken = { ...CLUB_START_FORFEIT_RULES, disqualifyAfter: 0 } as unknown as ForfeitRules;
    const { db, forfeit } = bout(broken);

    await expect(forfeit('voluntary', true)).rejects.toMatchObject({
      status: 409,
      response: { code: 'forfeit_rules_invalid' },
    });
    expect(writesTo(db, 'match_forfeits')).toEqual([]);
  });

  it('do not stop an override, which reads no forfeit rule', async () => {
    const broken = { reasons: {} } as unknown as ForfeitRules;
    const { db } = bout(broken);
    const service = new MatchForfeitsService(
      db as never,
      undefined as never,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    );

    await service.createForfeit('m1', {
      forfeitingRegistrationId: 'reg-red',
      reason: 'admin_correction',
      explicitScores: { forfeitingScore: 1, opponentScore: 4 },
    });

    expect(inserted(db)).toEqual([expect.objectContaining({ score_policy: 'explicit' })]);
  });
});
