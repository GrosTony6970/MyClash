import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomRulesetsService } from './custom-rulesets.service';
import { createRulesetRegistry } from '../../rulesets/ruleset-registry';

// Delist ≠ delete: a ruleset a tournament still pins must resolve forever, so
// destructive/lifecycle actions on it either soft-archive (delete) or refuse
// outright (unpublish/rollback) rather than orphan the pinned tournament. Split
// out of custom-rulesets.service.test.ts to keep that file under the 400-line
// cap (mirrors the custom-rulesets.catalog.test.ts split).
describe('CustomRulesetsService — durability (delist ≠ delete)', () => {
  const fromMock = vi.fn();
  const service = new CustomRulesetsService(
    { service: { from: fromMock } } as never,
    createRulesetRegistry(),
  );

  const refParent = {
    id: 'r1',
    code: 'custom_x',
    version: '1.0.0',
    is_system: false,
    is_default: false,
  };

  // Routes each table to its own resolved shape: tournaments answer the
  // reference COUNT; custom_rulesets answer the parent row and record whether
  // update() (archive) or delete() was called.
  function durabilityDispatch(opts: {
    tournamentCount: number;
    /** The bouts that carry the ruleset's code; a Tournament may have moved off it since. */
    boutCount?: number;
    countError?: { message: string };
    boutCountError?: { message: string };
    /** The copies of a bout's rules that name the code (0229), held by a bout or not. */
    copyCount?: number;
    capture: {
      update?: Record<string, unknown>;
      deleted?: boolean;
      /** The `.eq()` filters of each bout count: the double answers whatever is filtered. */
      boutFilters?: Array<Array<[string, unknown]>>;
    };
  }) {
    return vi.fn().mockImplementation((table: string) => {
      const result =
        table === 'tournaments'
          ? { count: opts.tournamentCount, error: opts.countError ?? null }
          : table === 'matches'
            ? { count: opts.boutCount ?? 0, error: opts.boutCountError ?? null }
            : table === 'match_rules'
              ? { count: opts.copyCount ?? 0, error: null }
              : { data: refParent, error: null };
      const filters: Array<[string, unknown]> = [];
      if (table === 'matches') (opts.capture.boutFilters ??= []).push(filters);
      const chain: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockImplementation((column: string, value: unknown) => {
          filters.push([column, value]);
          return chain;
        }),
        order: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(result),
        single: vi.fn().mockResolvedValue(result),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          if (table === 'custom_rulesets') opts.capture.update = payload;
          return chain;
        }),
        delete: vi.fn().mockImplementation(() => {
          if (table === 'custom_rulesets') opts.capture.deleted = true;
          return chain;
        }),
        then: (resolve: (v: unknown) => unknown) => resolve(result),
      };
      return chain;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('soft-archives instead of deleting when a tournament references it (remove)', async () => {
    const capture: { update?: Record<string, unknown>; deleted?: boolean } = {};
    fromMock.mockImplementation(durabilityDispatch({ tournamentCount: 1, capture }));
    await expect(service.remove('r1', 'actor-1')).resolves.toEqual({ archived: true });
    expect(capture.update).toMatchObject({ status: 'archived' });
    expect(capture.deleted).toBeUndefined();
  });

  // The Tournament moved to another ruleset after its bouts were fought under this one. The
  // bouts keep this code: hard-deleted, a correction of one of them scored it with TF_v1.
  it.each<['remove' | 'deleteForOrg']>([['remove'], ['deleteForOrg']])(
    'soft-archives when only a bout still carries it (%s)',
    async (door) => {
      const capture: { update?: Record<string, unknown>; deleted?: boolean } = {};
      fromMock.mockImplementation(
        durabilityDispatch({ tournamentCount: 0, boutCount: 3, capture }),
      );
      await expect(service[door]('r1', 'actor-1')).resolves.toEqual({ archived: true });
      expect(capture.update).toMatchObject({ status: 'archived' });
      expect(capture.deleted).toBeUndefined();
    },
  );

  // A Tournament moved off the ruleset before any bout started: only a copy names it now, and an
  // archive carrying that copy restores only if the ruleset still resolves (0229).
  it.each<['remove' | 'deleteForOrg']>([['remove'], ['deleteForOrg']])(
    'soft-archives when only a copy of a bout’s rules names it (%s)',
    async (door) => {
      const capture: { update?: Record<string, unknown>; deleted?: boolean } = {};
      fromMock.mockImplementation(
        durabilityDispatch({ tournamentCount: 0, boutCount: 0, copyCount: 1, capture }),
      );
      await expect(service[door]('r1', 'actor-1')).resolves.toEqual({ archived: true });
      expect(capture.deleted).toBeUndefined();
    },
  );

  // "Could not count" is not "no one uses it": read as 0, the ruleset was hard-deleted.
  it('deletes nothing when the count cannot be read', async () => {
    const capture: { update?: Record<string, unknown>; deleted?: boolean } = {};
    const countError = { message: 'connection reset' };
    fromMock.mockImplementation(durabilityDispatch({ tournamentCount: 0, countError, capture }));
    await expect(service.remove('r1', 'actor-1')).rejects.toThrow('connection reset');
    expect(capture.deleted).toBeUndefined();
    expect(capture.update).toBeUndefined();
  });

  it('hard-deletes when no tournament references it (remove)', async () => {
    const capture: { update?: Record<string, unknown>; deleted?: boolean } = {};
    fromMock.mockImplementation(durabilityDispatch({ tournamentCount: 0, capture }));
    await expect(service.remove('r1', 'actor-1')).resolves.toEqual({ archived: false });
    expect(capture.deleted).toBe(true);
    expect(capture.update).toBeUndefined();
  });

  it('soft-archives instead of deleting when referenced (deleteForOrg)', async () => {
    const capture: { update?: Record<string, unknown>; deleted?: boolean } = {};
    fromMock.mockImplementation(durabilityDispatch({ tournamentCount: 1, capture }));
    await expect(service.deleteForOrg('r1', 'actor-1')).resolves.toEqual({ archived: true });
    expect(capture.update).toMatchObject({ status: 'archived' });
    expect(capture.deleted).toBeUndefined();
  });

  it('hard-deletes an unreferenced org ruleset (deleteForOrg)', async () => {
    const capture: { update?: Record<string, unknown>; deleted?: boolean } = {};
    fromMock.mockImplementation(durabilityDispatch({ tournamentCount: 0, capture }));
    await expect(service.deleteForOrg('r1', 'actor-1')).resolves.toEqual({ archived: false });
    expect(capture.deleted).toBe(true);
    expect(capture.update).toBeUndefined();
  });

  it('refuses to unpublish a version a tournament still references', async () => {
    fromMock.mockImplementation(durabilityDispatch({ tournamentCount: 1, capture: {} }));
    await expect(service.unpublish('r1', 'actor-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to roll back a version a tournament still references', async () => {
    fromMock.mockImplementation(durabilityDispatch({ tournamentCount: 1, capture: {} }));
    await expect(service.rollback('r1', 'v1', 'actor-1')).rejects.toBeInstanceOf(ConflictException);
  });

  // The Tournament moved to another ruleset after its bouts were fought under this version. Edited,
  // a correction of one of those bouts was decided by the new formula, and nothing said so.
  const freezeDoors = {
    update: () => service.update('r1', { name: 'Renamed' }, 'actor-1'),
    unpublish: () => service.unpublish('r1', 'actor-1'),
    rollback: () => service.rollback('r1', 'v1', 'actor-1'),
  };
  it.each(Object.keys(freezeDoors) as Array<keyof typeof freezeDoors>)(
    'refuses %s while a bout still carries this version, its Tournament gone elsewhere',
    async (door) => {
      const capture: Parameters<typeof durabilityDispatch>[0]['capture'] = {};
      fromMock.mockImplementation(
        durabilityDispatch({ tournamentCount: 0, boutCount: 2, capture }),
      );
      await expect(freezeDoors[door]()).rejects.toBeInstanceOf(ConflictException);
      expect(capture.update).toBeUndefined();
      // Asked about this version, not about the code: another version's bouts do not freeze it.
      expect(capture.boutFilters).toContainEqual([
        ['ruleset_code', 'custom_x'],
        ['ruleset_version', '1.0.0'],
      ]);
    },
  );

  // "Could not count" is not "no one uses it": read as 0, the edit went through.
  it.each([
    ['Tournaments', { countError: { message: 'connection reset' } }],
    ['bouts', { boutCountError: { message: 'connection reset' } }],
  ])('refuses an edit when the %s cannot be counted', async (_who, failure) => {
    const capture: Parameters<typeof durabilityDispatch>[0]['capture'] = {};
    fromMock.mockImplementation(durabilityDispatch({ tournamentCount: 0, ...failure, capture }));
    await expect(freezeDoors.update()).rejects.toThrow('connection reset');
    expect(capture.update).toBeUndefined();
  });
});
