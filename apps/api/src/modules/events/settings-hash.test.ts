/**
 * The rules fingerprint of a settings save rides in the save's own update (revisions 9 fold 1, 10
 * fold 2, 11 fold 6 of the audited settings change): written when the save changes what it covers,
 * or a button's value, or the card pin; left alone otherwise, so a drifted Tournament keeps its
 * banner until a save that is a fresh look at its rules.
 *
 * The REAL `updateTournament` and fingerprint over seeded tables (`rules-write.fixtures`).
 */
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as MatchRuleset from '../phases/match-ruleset';
import { writesTo } from '../../common/testing/supabase-chain';
import type { TournamentHashRow } from '../ruleset-hash/ruleset-hash.service';
import { assertOrgRole, harness, ON_TF_1_0_0, type Row } from './rules-write.fixtures';

vi.mock('../phases/match-ruleset', async (original) => ({
  ...(await original<typeof MatchRuleset>()),
  restampUnstartedMatches: vi.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  vi.clearAllMocks();
  assertOrgRole.mockResolvedValue(undefined);
});

// The warning spy mutes the logger: put it back for the next test.
afterEach(() => vi.restoreAllMocks());

/** A draft whose stored fingerprint no longer matches its rules: its banner shows. */
const DRIFTED: Row = { ...ON_TF_1_0_0, ruleset_content_hash: 'a-stale-fingerprint' };
/** A stored format out of the canonical's domain: its fingerprint cannot be computed. */
const BROKEN: Row = { ...DRIFTED, ruleset_config: { matchFormat: { pointCap: -4 } } };

async function saved(patch: Row, current: Row = DRIFTED) {
  const h = harness(current);
  await h.svc.updateTournament('t1', patch as never, 'u1');
  const writes = writesTo(h.db, 'tournaments').map((w) => w.row as Row);
  const update = writes[0] ?? {};
  /** The fingerprint of the row as the save leaves it. */
  const hashOfWritten = () =>
    h.rulesHash.contentHashOf({ ...current, ...update } as unknown as TournamentHashRow);
  return { writes, update, hashOfWritten };
}

const buttonsWith = (change: (button: Row) => Row) => {
  const scoring = DRIFTED['scoring_config_json'] as { buttons: { clean: Row[] } };
  const clean = scoring.buttons.clean.map((b, i) => (i === 0 ? change(b) : b));
  return { scoringConfig: { buttons: { ...scoring.buttons, clean } } };
};

describe('the fingerprint of a settings save', () => {
  it('is written in the save itself when the cap changes, as the written row hashes', async () => {
    const { writes, update, hashOfWritten } = await saved({
      rulesetConfig: { matchFormat: { pointCap: 9 } },
    });
    expect(update['ruleset_content_hash']).toBe(await hashOfWritten());
    // One write: no separate stamp of the hash after it.
    expect(writes).toHaveLength(1);
  });

  it("is written when a button's value changes: not covered, but a fresh look at the rules", async () => {
    const { update, hashOfWritten } = await saved(buttonsWith((b) => ({ ...b, value: 3 })));
    expect(update['ruleset_content_hash']).toBe(await hashOfWritten());
  });

  it("is left alone by a button's label: the drifted Tournament keeps its banner", async () => {
    const { update } = await saved(buttonsWith((b) => ({ ...b, label: 'Two' })));
    expect(update).not.toHaveProperty('ruleset_content_hash');
  });

  it('is left alone by a save of the name', async () => {
    const { update } = await saved({ name: 'Sabre Open' });
    expect(update).not.toHaveProperty('ruleset_content_hash');
  });

  it('is left out, warned, and the save still made, when it cannot be computed', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    // An out-of-domain stored format: the canonical refuses it, and a colour change saves.
    const scoring = DRIFTED['scoring_config_json'] as Row;
    const { writes, update } = await saved(
      { scoringConfig: { ...scoring, display: { sideColors: { red: 'red', blue: 'blue' } } } },
      BROKEN,
    );
    expect(writes).toHaveLength(1);
    expect(update).not.toHaveProperty('ruleset_content_hash');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('The rules fingerprint of Tournament t1 was not computed'),
    );
  });

  it('is written by the save that repairs a stored config it could not hash', async () => {
    const { update, hashOfWritten } = await saved(
      { rulesetConfig: { matchFormat: { pointCap: 9 } } },
      BROKEN,
    );
    expect(update['ruleset_content_hash']).toBe(await hashOfWritten());
  });
});
