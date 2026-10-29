/**
 * A Tournament's changes of its forfeit rules lock once a bout has started (operator ruling 73,
 * 2026-10-20), as its card rules do. The lock sees only a REAL change: the stored changes before
 * and after the save, compared as canonical JSON. A Reset of a key it does not hold, or the same
 * changes in another key order, passes. A real change goes through the audit (rulings 142, 147):
 * its refusal, entries and Fighters are `settings-forfeit.lock.test.ts`'s.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RULES_CHANGE_CODES } from '@myclash/types';
import type * as MatchRuleset from '../phases/match-ruleset';
import { assertOrgRole, harness, restamped, RUNNING_TF } from './repin-guard.fixtures';

vi.mock('../phases/match-ruleset', async (original) => ({
  ...(await original<typeof MatchRuleset>()),
  restampUnstartedMatches: vi.fn(() => Promise.resolve()),
}));

const STORED = { reasons: { injury: { fighter: 'withdrawn', opponentScore: 9 } } };
const ON_A_STARTED_BOUT = { bouts: [{ status: 'running' }] };

function save(patch: Record<string, unknown>, stored: unknown = STORED, started = true) {
  const opened = harness({
    // A draft: a fought bout, or none, decides the lock (a running status locks on its own).
    current: { ...RUNNING_TF, status: 'draft', forfeit_rules: stored },
    ...(started ? ON_A_STARTED_BOUT : {}),
  });
  const stamp = vi.spyOn(
    opened.svc as unknown as { stampTournamentContentHash: (id: string) => Promise<void> },
    'stampTournamentContentHash',
  );
  return { ...opened, stamp, saved: opened.svc.updateTournament('t1', patch as never, 'u1') };
}

beforeEach(() => {
  vi.clearAllMocks();
  assertOrgRole.mockResolvedValue(undefined);
});

describe('the forfeit rules of a Tournament whose bout has started', () => {
  it('take the same changes sent again, in another key order', async () => {
    const reordered = { reasons: { injury: { opponentScore: 9, fighter: 'withdrawn' } } };
    const { saved, cap } = save({ forfeitRules: reordered });

    await expect(saved).resolves.toBeDefined();
    expect(cap.update).not.toHaveProperty('forfeit_rules');
  });

  it('take a Reset of a key the Tournament does not hold', async () => {
    const { saved, cap } = save({ forfeitRules: { blackCardOpponentScore: null } });

    await expect(saved).resolves.toBeDefined();
    expect(cap.update).not.toHaveProperty('forfeit_rules');
  });

  it('take a save of no change over a stored `{}`, which changes nothing either', async () => {
    const { saved, cap } = save({ forfeitRules: {} }, {});

    await expect(saved).resolves.toBeDefined();
    expect(cap.update).not.toHaveProperty('forfeit_rules');
  });

  it('take a save of the name only, and restamp no bout', async () => {
    const { saved, cap, stamp } = save({ name: 'Longsword open' });

    await expect(saved).resolves.toBeDefined();
    expect(cap.update).not.toHaveProperty('forfeit_rules');
    expect(stamp).not.toHaveBeenCalled();
    expect(restamped()).toEqual([]);
  });
});

describe('the forfeit rules of a Tournament no bout of which has started', () => {
  it('write the changes after the save, and restamp the bouts not started', async () => {
    const { saved, cap, stamp } = save({ forfeitRules: { disqualifyAfter: 4 } }, STORED, false);

    await saved;
    expect(cap.update?.['forfeit_rules']).toEqual({ ...STORED, disqualifyAfter: 4 });
    // The fingerprint rides in the save's own update (revision 10 fold 2; its arms are tested in
    // `settings-hash.test.ts`): no stamp after the write.
    expect(stamp).not.toHaveBeenCalled();
    expect(restamped()).toEqual(['t1']);
  });

  it('write NULL once a Reset leaves nothing', async () => {
    const reset = { reasons: { injury: { fighter: null, opponentScore: null } } };
    const { saved, cap } = save({ forfeitRules: reset }, STORED, false);

    await saved;
    expect(cap.update).toHaveProperty('forfeit_rules', null);
  });
});

describe('the card pin of a Tournament whose bout has started', () => {
  it('is refused with the code the Basics tab words', async () => {
    const { saved } = save({ penaltyRulesetId: 'pr-2' }, null);

    await expect(saved).rejects.toMatchObject({
      status: 403,
      response: { code: RULES_CHANGE_CODES.cardLocked },
    });
  });
});
