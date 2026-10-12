/**
 * "Acknowledge the rules changed" moves the bouts not yet started.
 *
 * A super admin edits the built-in penalty rules. The organiser's settings page
 * says the rules of the Tournament changed, and the organiser accepts. The
 * Tournament took the new hash and its bouts not yet started kept the old one:
 * each recorded rules it would not be fought under.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { restampUnstartedMatches } from '../phases/match-ruleset';
import type * as MatchRuleset from '../phases/match-ruleset';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';
import { EventsService } from './events.service';

// The restamp has its own tests (`match-ruleset.restamp.test.ts`). Here: this
// door calls it, after the Tournament's hash, and only for an organiser.
vi.mock('../phases/match-ruleset', async (original) => ({
  ...(await original<typeof MatchRuleset>()),
  restampUnstartedMatches: vi.fn(() => Promise.resolve()),
}));

const order: string[] = [];
const assertOrgRole = vi.fn();
const stampTournamentContentHash = vi.fn(() => {
  order.push('hash');
  return Promise.resolve();
});

function service() {
  const supabase = mockSupabase({
    tournaments: { data: { event_id: 'e1' }, error: null },
    events: { data: { id: 'e1', organization_id: 'org-1' }, error: null },
  });
  const optional = undefined as never;
  return new EventsService(
    supabase as never,
    { assertOrgRole } as never,
    {} as never,
    createRulesetRegistry(),
    optional,
    optional,
    optional,
    optional,
    optional,
    { stampTournamentContentHash } as never,
  );
}

describe('acknowledgeTournamentRulesetDrift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    order.length = 0;
    assertOrgRole.mockResolvedValue(undefined);
    vi.mocked(restampUnstartedMatches).mockImplementation(() => {
      order.push('bouts');
      return Promise.resolve();
    });
  });

  it("stamps the Tournament's hash, then its bouts not yet started", async () => {
    await expect(service().acknowledgeTournamentRulesetDrift('t1', 'u1')).resolves.toEqual({
      drifted: false,
    });

    expect(stampTournamentContentHash).toHaveBeenCalledWith('t1');
    expect(vi.mocked(restampUnstartedMatches).mock.calls.map((call) => call[1])).toEqual(['t1']);
    // The bouts copy the Tournament's hash: the Tournament's comes first.
    expect(order).toEqual(['hash', 'bouts']);
  });

  it('moves no bout for a caller who may not manage the Tournament', async () => {
    assertOrgRole.mockRejectedValue(new Error('not an admin of this organisation'));

    await expect(service().acknowledgeTournamentRulesetDrift('t1', 'u1')).rejects.toThrow(
      'not an admin of this organisation',
    );

    expect(order).toEqual([]);
  });
});
