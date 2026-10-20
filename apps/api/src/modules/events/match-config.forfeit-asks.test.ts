/**
 * The pad asks "can the Fighter continue?" only when the reason's rule asks (operator ruling 76,
 * 2026-10-20). `GET tournaments/:id/match-config` answers which reasons ask, and nothing more of the
 * forfeit rules. The answer is contained: rules that cannot be read or do not parse answer
 * `forfeitAsks: null` and a log line, and the pad still gets its scoring rules.
 */
import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLUB_START_FORFEIT_RULES, type ForfeitRules } from '@myclash/types/forfeit-rules';
import { mockSupabase, queriedTables } from '../../common/testing/supabase-chain';
import { RulesetResolver } from '../matches/ruleset-resolver.service';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';
import { readMatchConfig } from './match-config';
import { ON_TF_1_0_0 } from './rules-write.fixtures';

const EVENT = { id: 'e1', status: 'published', organization_id: 'org-1', event_kind: null };

/** The built-in's rules, but a voluntary withdrawal does not ask: a value no start holds. */
const MARKER: ForfeitRules = {
  ...CLUB_START_FORFEIT_RULES,
  reasons: {
    ...CLUB_START_FORFEIT_RULES.reasons,
    voluntary: { outcome: 'fixed_loss', opponentScore: 6, fighter: 'continues' },
  },
};

/** The pad's read of a Tournament that pins no penalty ruleset: the built-in's rules answer. */
async function readWith(penaltyRulesets: Record<string, unknown>, changes: unknown = null) {
  const db = mockSupabase({
    tournaments: {
      rows: [
        {
          ...ON_TF_1_0_0,
          penalty_ruleset_id: null,
          event_id: 'e1',
          events: EVENT,
          forfeit_rules: changes,
        },
      ],
    },
    events: { rows: [{ id: 'e1', penalty_ruleset_id: null }] },
    penalty_rulesets: penaltyRulesets,
  });
  const rulesets = new RulesetResolver(db as never, createRulesetRegistry());
  const deps = { supabase: db, orgs: {}, rulesets } as never;
  const answer = await readMatchConfig(deps, 't1', { userId: 'anonymous', staff: null });
  return Object.assign(db, { answer });
}
const read = async (penaltyRulesets: Record<string, unknown>) =>
  (await readWith(penaltyRulesets)).answer;

const builtIn = (forfeitRules: unknown) => ({
  rows: [
    {
      id: 'built-in',
      built_in: true,
      owner_organization_id: null,
      first_black_card_forfeit: 'match',
      second_black_card_forfeit: 'tournament',
      forfeit_rules: forfeitRules,
    },
  ],
});

let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.restoreAllMocks();
  error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

describe('the pad’s rules say which forfeit reasons ask whether the Fighter continues', () => {
  it('answer each reason’s rule, and no other forfeit rule', async () => {
    const answer = await read(builtIn(MARKER));

    expect(answer.forfeitAsks).toEqual({
      injury: true,
      voluntary: false,
      conduct_violation: false,
    });
    expect(JSON.stringify(answer)).not.toContain('disqualifyAfter');
  });

  it('answer the rules the Tournament plays: its own changes over the ruleset’s (ruling 65)', async () => {
    const changes = {
      reasons: { voluntary: { fighter: 'asks' }, injury: { fighter: 'withdrawn' } },
    };
    const { answer } = await readWith(builtIn(MARKER), changes);

    expect(answer.forfeitAsks).toEqual({
      injury: false,
      voluntary: true,
      conduct_violation: false,
    });
  });

  it('cost the card rules’ pin chain after the Tournament’s row, read once', async () => {
    const db = await readWith(builtIn(MARKER));

    // The row; then the Tournament's pin, its Event's, the built-in's id and the built-in row.
    expect(queriedTables(db.from)).toEqual([
      'tournaments',
      'tournaments',
      'events',
      'penalty_rulesets',
      'penalty_rulesets',
    ]);
    expect(db.answer.forfeitAsks).not.toBeNull();
    expect(error).not.toHaveBeenCalled();
  });

  it('answer null, and the scoring rules, when the stored rules do not parse', async () => {
    const answer = await read(builtIn({ ...MARKER, disqualifyAfter: 0 }));

    expect(answer.forfeitAsks).toBeNull();
    expect(answer.matchFormat).toBeDefined();
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/^Tournament t1: the forfeit questions not answered/),
      expect.anything(),
    );
  });

  it('answer null, and the scoring rules, when the penalty ruleset cannot be read', async () => {
    const answer = await read({ data: null, error: { message: 'connection reset' } });

    expect(answer.forfeitAsks).toBeNull();
    expect(answer.matchFormat).toBeDefined();
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/^Tournament t1: the forfeit questions not answered: .*/),
      expect.anything(),
    );
  });
});
