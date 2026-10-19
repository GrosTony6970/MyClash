import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomRulesetsService } from './custom-rulesets.service';
import { lastFunctionParams } from '../../../common/testing/migration-function';
import { supabaseRpc } from '../../../common/testing/supabase-chain';
import { createRulesetRegistry } from '../../rulesets/ruleset-registry';

// Delist ≠ delete: a ruleset a tournament still pins must resolve forever, so
// destructive/lifecycle actions on it either soft-archive (delete) or refuse
// outright (unpublish/rollback) rather than orphan the pinned tournament. Split
// out of custom-rulesets.service.test.ts to keep that file under the 400-line
// cap (mirrors the custom-rulesets.catalog.test.ts split).
describe('CustomRulesetsService — durability (delist ≠ delete)', () => {
  const fromMock = vi.fn();
  const rpcMock = vi.fn();
  const service = new CustomRulesetsService(
    { service: { from: fromMock, rpc: rpcMock } } as never,
    createRulesetRegistry(),
  );

  const refParent = {
    id: 'r1',
    code: 'custom_x',
    version: '1.0.0',
    is_system: false,
    is_default: false,
  };

  interface DispatchOptions {
    tournamentCount: number;
    countError?: { message: string };
    /** A bout holds a copy naming the version; a Tournament may have moved off it since. */
    held?: boolean | null;
    heldError?: { message: string };
    /** The copies of a bout's rules that name the code (0229), held by a bout or not. */
    copyCount?: number;
    capture: {
      update?: Record<string, unknown>;
      deleted?: boolean;
      /** The payload of each rpc call: the double answers whatever is asked. */
      held?: Array<Record<string, unknown>>;
      /** The tables whose `select` is a head count, in call order. */
      counted?: string[];
    };
  }

  // Answers the rpc that asks whether a bout holds a copy naming the version
  // (ruling M), and keeps its payloads.
  function answerHeld(opts: DispatchOptions) {
    rpcMock.mockImplementation(
      supabaseRpc({
        ruleset_pair_held_by_a_bout: (args) => {
          (opts.capture.held ??= []).push(args);
          return {
            data: opts.held === undefined ? false : opts.held,
            error: opts.heldError ?? null,
          };
        },
      }),
    );
  }

  // Routes each table to its own resolved shape: tournaments answer the
  // reference COUNT; custom_rulesets answer the parent row and record whether
  // update() (archive) or delete() was called. The rpc as `answerHeld`.
  function durabilityDispatch(opts: DispatchOptions) {
    answerHeld(opts);
    return vi.fn().mockImplementation((table: string) => {
      const result =
        table === 'tournaments'
          ? { count: opts.tournamentCount, error: opts.countError ?? null }
          : table === 'match_rules'
            ? { count: opts.copyCount ?? 0, error: null }
            : { data: refParent, error: null };
      const chain: Record<string, unknown> = {
        select: vi
          .fn()
          .mockImplementation((_columns: string, options?: { count?: string; head?: boolean }) => {
            if (options?.count === 'exact' && options.head === true)
              (opts.capture.counted ??= []).push(table);
            return chain;
          }),
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

  // The Tournament moved to another ruleset after its bouts were fought under this one, or before
  // any bout started: only a copy of a bout's rules names it now (every bout holds one, 0232).
  // Hard-deleted, a correction of one of those bouts could not be scored, and an archive carrying
  // the copy would not restore: it restores only if the ruleset still resolves (0229).
  it.each<['remove' | 'deleteForOrg']>([['remove'], ['deleteForOrg']])(
    'soft-archives when only a copy of a bout’s rules names it (%s)',
    async (door) => {
      const capture: { update?: Record<string, unknown>; deleted?: boolean } = {};
      fromMock.mockImplementation(
        durabilityDispatch({ tournamentCount: 0, copyCount: 1, capture }),
      );
      await expect(service[door]('r1', 'actor-1')).resolves.toEqual({ archived: true });
      expect(capture.update).toMatchObject({ status: 'archived' });
      expect(capture.deleted).toBeUndefined();
    },
  );

  // The Tournaments and the copies are every place a ruleset is named: a bout names its rules
  // only through its copy (0232).
  it.each<['remove' | 'deleteForOrg']>([['remove'], ['deleteForOrg']])(
    'counts the Tournaments and the copies of bouts’ rules, nothing else (%s)',
    async (door) => {
      const capture: Parameters<typeof durabilityDispatch>[0]['capture'] = {};
      fromMock.mockImplementation(durabilityDispatch({ tournamentCount: 0, capture }));
      await expect(service[door]('r1', 'actor-1')).resolves.toEqual({ archived: false });
      expect(capture.counted).toEqual(['tournaments', 'match_rules']);
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
  // a correction of one of those bouts was decided by the new formula, and nothing said so. A bout
  // not started that still holds an earlier copy naming it locks it too (ruling M): a Start pressed
  // with no network may put the bout back on that copy.
  const freezeDoors = {
    update: () => service.update('r1', { name: 'Renamed' }, 'actor-1'),
    unpublish: () => service.unpublish('r1', 'actor-1'),
    rollback: () => service.rollback('r1', 'v1', 'actor-1'),
  };
  it.each(Object.keys(freezeDoors) as Array<keyof typeof freezeDoors>)(
    'refuses %s while a bout holds a copy naming this version, its Tournament gone elsewhere',
    async (door) => {
      const capture: Parameters<typeof durabilityDispatch>[0]['capture'] = {};
      fromMock.mockImplementation(durabilityDispatch({ tournamentCount: 0, held: true, capture }));
      await expect(freezeDoors[door]()).rejects.toBeInstanceOf(ConflictException);
      expect(capture.update).toBeUndefined();
      // Asked about this version, not about the code: another version's bouts do not freeze it.
      expect(capture.held).toEqual([{ p_code: 'custom_x', p_version: '1.0.0' }]);
      // A key renamed on either side calls a function that does not exist.
      expect(Object.keys(capture.held?.[0] ?? {})).toEqual(
        lastFunctionParams('ruleset_pair_held_by_a_bout'),
      );
    },
  );

  it.each(Object.keys(freezeDoors) as Array<keyof typeof freezeDoors>)(
    'lets %s through when no Tournament pins this version and no bout holds a copy naming it',
    async (door) => {
      const capture: Parameters<typeof durabilityDispatch>[0]['capture'] = {};
      fromMock.mockImplementation(durabilityDispatch({ tournamentCount: 0, held: false, capture }));
      await expect(freezeDoors[door]()).resolves.toBeDefined();
      expect(capture.held).toEqual([{ p_code: 'custom_x', p_version: '1.0.0' }]);
      expect(capture.update).toBeDefined();
    },
  );

  // "Could not count" is not "no one uses it": read as 0, the edit went through.
  it('refuses an edit when the bouts are answered with no yes or no', async () => {
    const capture: Parameters<typeof durabilityDispatch>[0]['capture'] = {};
    fromMock.mockImplementation(durabilityDispatch({ tournamentCount: 0, held: null, capture }));
    await expect(freezeDoors.update()).rejects.toThrow('were not counted: no answer');
    expect(capture.update).toBeUndefined();
  });

  it.each([
    ['Tournaments', { countError: { message: 'connection reset' } }],
    ['bouts', { heldError: { message: 'connection reset' } }],
  ])('refuses an edit when the %s cannot be counted', async (_who, failure) => {
    const capture: Parameters<typeof durabilityDispatch>[0]['capture'] = {};
    fromMock.mockImplementation(durabilityDispatch({ tournamentCount: 0, ...failure, capture }));
    await expect(freezeDoors.update()).rejects.toThrow('were not counted: connection reset');
    expect(capture.update).toBeUndefined();
  });
});
