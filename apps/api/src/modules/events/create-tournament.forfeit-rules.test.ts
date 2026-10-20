/**
 * A Tournament created with changes of its forfeit rules (ruling 65, Step 1 of the wizard) stores
 * them as it stores a save of them: only the keys changed, and a Reset sent at create stores none.
 * The row is inserted before its hash is stamped, and the stamp reads the row's `forfeit_rules`
 * (`ruleset-hash.service.test.ts`), so the first fingerprint already describes them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertOrgRole, seedHarness } from './create-tournament.fixtures';

const BODY = { slug: 's', name: 'T', rulesetCode: 'TF_v1' };

beforeEach(() => {
  vi.clearAllMocks();
  assertOrgRole.mockResolvedValue(undefined);
});

describe('createTournament — the forfeit changes', () => {
  it('stores the changes it is sent', async () => {
    const { svc, inserted } = seedHarness();
    const marker = { reasons: { voluntary: { opponentScore: 37 } }, secondBlackCard: 'match' };

    await svc.createTournament('e1', { ...BODY, forfeitRules: marker } as never, 'u1');

    expect(inserted()?.['forfeit_rules']).toEqual(marker);
  });

  it('stores none when it is sent none, or only a Reset', async () => {
    for (const forfeitRules of [undefined, { disqualifyAfter: null }]) {
      const { svc, inserted } = seedHarness();

      await svc.createTournament('e1', { ...BODY, forfeitRules } as never, 'u1');

      expect(inserted()).toHaveProperty('forfeit_rules', null);
    }
  });
});
