import { describe, expect, it, vi } from 'vitest';
import {
  applyListed,
  applyReachable,
  isIndexable,
  isListed,
  isReachable,
  REACHABLE_COLUMNS,
} from './directory-predicate';

const LIVE = { deleted_at: null, merged_into_id: null, account_deleted_at: null };

/** A fighter who claimed their account and left both defaults alone. */
const LISTED = {
  ...LIVE,
  is_fighter: true,
  claimed_by_user_id: 'user-1',
  listed_in_directory: true,
  search_indexable: false,
};

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

describe('isListed', () => {
  it('accepts a claimed fighter who left the default alone', () => {
    expect(isListed(LISTED)).toBe(true);
  });

  it('excludes anyone who never claimed their account', () => {
    // The requirement carrying the weight. It is why listed_in_directory can
    // default TRUE at all: the imported majority -- typed into a CSV by an
    // organiser, never having visited MyClash -- is excluded regardless of what
    // that default says, because they cannot have agreed to anything.
    expect(isListed({ ...LISTED, claimed_by_user_id: null })).toBe(false);
  });

  it('excludes a non-fighter', () => {
    // Referees and instructors get their own directory later. Until then they
    // are simply not in this one.
    expect(isListed({ ...LISTED, is_fighter: false })).toBe(false);
  });

  it('excludes someone who opted out', () => {
    expect(isListed({ ...LISTED, listed_in_directory: false })).toBe(false);
  });

  it('excludes a merged or erased identity even when every flag says list me', () => {
    for (const dead of [
      { deleted_at: '2026-01-01' },
      { merged_into_id: 'gp-2' },
      { account_deleted_at: '2026-01-01' },
    ]) {
      expect(isListed({ ...LISTED, ...dead })).toBe(false);
    }
  });
});

describe('isIndexable', () => {
  it('requires the second, separate choice', () => {
    // search_indexable defaults FALSE: this is the half that cannot be undone,
    // because de-indexing is slow and never reaches caches or scrapers. A
    // listed fighter is NOT indexed until they ask a second time.
    expect(isIndexable(LISTED)).toBe(false);
    expect(isIndexable({ ...LISTED, search_indexable: true })).toBe(true);
  });

  it('is nested inside isListed, which is nested inside isReachable', () => {
    // The property the whole design rests on. Indexed-but-unlisted would be an
    // orphan page reachable only from a search result, with no route to it from
    // the site. 0187 enforces the same nesting with a CHECK; this asserts the
    // application cannot disagree with the database.
    const flags = [false, true];
    for (const is_fighter of flags)
      for (const listed_in_directory of flags)
        for (const search_indexable of flags)
          for (const claimed of [null, 'user-1'])
            for (const deleted_at of [null, '2026-01-01']) {
              const row = {
                ...LIVE,
                deleted_at,
                is_fighter,
                listed_in_directory,
                search_indexable,
                claimed_by_user_id: claimed,
              };
              if (isIndexable(row)) expect(isListed(row)).toBe(true);
              if (isListed(row)) expect(isReachable(row)).toBe(true);
            }
  });
});

describe('applyListed', () => {
  it('filters on every column isListed reads', () => {
    const chain = {
      is: vi.fn(),
      not: vi.fn(),
      eq: vi.fn(),
    } as unknown as Record<string, ReturnType<typeof vi.fn>>;
    for (const key of ['is', 'not', 'eq']) chain[key]?.mockReturnValue(chain);

    applyListed(chain as never);

    expect((chain['is']?.mock.calls ?? []).map((c) => c[0]).sort()).toEqual(
      [...REACHABLE_COLUMNS].sort(),
    );
    expect((chain['eq']?.mock.calls ?? []).map((c) => c[0]).sort()).toEqual([
      'is_fighter',
      'listed_in_directory',
    ]);
    // NOT NULL, not `= true`: claimed_by_user_id holds a uuid.
    expect(chain['not']).toHaveBeenCalledWith('claimed_by_user_id', 'is', null);
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
