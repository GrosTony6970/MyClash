import { describe, expect, it, vi } from 'vitest';
import { applyReachable, isReachable, REACHABLE_COLUMNS } from './directory-predicate';

const LIVE = { deleted_at: null, merged_into_id: null, account_deleted_at: null };

describe('isReachable', () => {
  it('accepts a live identity', () => {
    expect(isReachable(LIVE)).toBe(true);
  });

  it('rejects a row merged away, from either side', () => {
    expect(isReachable({ ...LIVE, deleted_at: '2026-01-01T00:00:00Z' })).toBe(false);
    expect(isReachable({ ...LIVE, merged_into_id: 'gp-2' })).toBe(false);
  });

  it('rejects an erased account', () => {
    // lookup_global_persons has NEVER filtered this one -- it predates the
    // account_deleted_at column -- so the fuzzy branch returned erased people
    // while the ilike branch did not.
    expect(isReachable({ ...LIVE, account_deleted_at: '2026-01-01T00:00:00Z' })).toBe(false);
  });

  it('treats a missing column as absent, not as a failure', () => {
    // Rows reach this from several projections; an undefined column must not
    // read as "excluded" and blank the directory.
    expect(isReachable({})).toBe(true);
  });

  it('does not require a claim, a role flag or a listing', () => {
    // The decision this encodes: profiles are linked from club rosters and
    // follow lists, and most of the population was imported from a CSV and has
    // never claimed anything. Gating reachability on those would 404 most of
    // the platform.
    expect(isReachable({ ...LIVE, is_fighter: false, claimed_by_user_id: null } as never)).toBe(
      true,
    );
  });
});

describe('applyReachable', () => {
  it('filters on exactly the columns the predicate reads', () => {
    // The in-memory check and the query have to select the same set. Asserting
    // against REACHABLE_COLUMNS is what makes adding a condition to one and not
    // the other fail here rather than in production.
    const chain = { is: vi.fn() } as unknown as { is: ReturnType<typeof vi.fn> };
    chain.is.mockReturnValue(chain);

    applyReachable(chain as never);

    expect(chain.is.mock.calls.map((call) => call[0]).sort()).toEqual(
      [...REACHABLE_COLUMNS].sort(),
    );
    for (const call of chain.is.mock.calls) {
      expect(call[1]).toBeNull();
    }
  });
});
