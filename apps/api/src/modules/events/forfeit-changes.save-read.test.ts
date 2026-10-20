/**
 * A save of a Tournament's forfeit changes (ruling 65), read back the way a black card and a hand
 * forfeit read them: the real `updateTournament` write, then the real pin chain over the row as
 * written (`cardAndForfeitRules`). The Tournament plays the built-in FFAMHE rules, which
 * disqualify after 2 forfeits.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FFAMHE_FORFEIT_RULES } from '@myclash/types/forfeit-rules';
import type * as MatchRuleset from '../phases/match-ruleset';
import { cardAndForfeitRules } from '../penalties/forfeit-rules-in-force';
import { assertOrgRole, harness, ON_TF_1_0_0, type Row } from './rules-write.fixtures';
import { writesTo } from '../../common/testing/supabase-chain';

vi.mock('../phases/match-ruleset', async (original) => ({
  ...(await original<typeof MatchRuleset>()),
  restampUnstartedMatches: vi.fn(() => Promise.resolve()),
}));

const BUILT_IN = {
  id: 'pr-ffamhe',
  built_in: true,
  owner_organization_id: null,
  yellow_card_points: 0,
  red_card_points: -1,
  black_card_points: 0,
  first_black_card_forfeit: 'match',
  second_black_card_forfeit: 'tournament',
  forfeit_rules: FFAMHE_FORFEIT_RULES,
};

/** The save, the row as written, and the rules in force read back over it. */
async function saveThenRead(stored: Row | null, forfeitRules: Row) {
  const h = harness(
    { ...ON_TF_1_0_0, forfeit_rules: stored },
    {},
    {
      penalty_rulesets: { rows: [BUILT_IN] },
    },
  );
  await h.svc.updateTournament('t1', { forfeitRules } as never, 'u1');
  const write = writesTo(h.db, 'tournaments').find((w) => 'forfeit_rules' in (w.row as Row));
  // The double applies no write: lay the one sent over the row the reads see.
  h.row['forfeit_rules'] = (write?.row as Row | undefined)?.['forfeit_rules'];
  return {
    written: h.row['forfeit_rules'],
    read: await cardAndForfeitRules(h.db.service as never, 't1'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  assertOrgRole.mockResolvedValue(undefined);
});

describe("a save of a Tournament's forfeit changes, read back", () => {
  it('plays the changes it saved', async () => {
    const { read } = await saveThenRead(null, {
      reasons: { injury: { opponentScore: 41 } },
      firstBlackCard: 'tournament',
    });

    expect(read.forfeitRules.reasons.injury).toEqual({
      ...FFAMHE_FORFEIT_RULES.reasons.injury,
      opponentScore: 41,
    });
    expect(read.forfeitRules.firstBlackCard).toBe('tournament');
  });

  it('a Reset of one reason field plays the ruleset’s, and keeps the other field', async () => {
    const stored = { reasons: { injury: { opponentScore: 41, fighter: 'withdrawn' } } };
    const { written, read } = await saveThenRead(stored, {
      reasons: { injury: { opponentScore: null } },
    });

    expect(written).toEqual({ reasons: { injury: { fighter: 'withdrawn' } } });
    expect(read.forfeitRules.reasons.injury).toMatchObject({
      opponentScore: 6,
      fighter: 'withdrawn',
    });
  });

  it('a Reset of the last nested key stores NULL, and plays the ruleset', async () => {
    const { written, read } = await saveThenRead(
      { reasons: { injury: { opponentScore: 41 } } },
      { reasons: { injury: { opponentScore: null } } },
    );

    expect(written).toBeNull();
    expect(read.forfeitRules).toMatchObject(FFAMHE_FORFEIT_RULES);
  });

  it('on FFAMHE, "disqualify after" Off plays Off, and its Reset plays 2 again', async () => {
    const off = await saveThenRead(null, { disqualifyAfter: 'off' });
    expect(off.read.forfeitRules.disqualifyAfter).toBe('off');

    const reset = await saveThenRead({ disqualifyAfter: 'off' }, { disqualifyAfter: null });
    expect(reset.read.forfeitRules.disqualifyAfter).toBe(2);
  });
});
