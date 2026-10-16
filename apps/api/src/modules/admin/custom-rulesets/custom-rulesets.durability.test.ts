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
    capture: { update?: Record<string, unknown>; deleted?: boolean };
  }) {
    return vi.fn().mockImplementation((table: string) => {
      const result =
        table === 'tournaments'
          ? { count: opts.tournamentCount, error: opts.countError ?? null }
          : table === 'matches'
            ? { count: opts.boutCount ?? 0, error: null }
            : { data: refParent, error: null };
      const chain: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
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
});
