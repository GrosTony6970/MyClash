import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { LeagueScoringSystemsService, bumpPatch } from './league-scoring-systems.service';

type Result = { data: unknown; error: { message: string } | null };

function buildSupabase(handlers: {
  platformRole?: Result;
  systemById?: Result;
  insertResult?: Result;
  updateResult?: Result;
  leaguesUsingCode?: { count: number | null; error: { message: string } | null };
}) {
  const inserted: unknown[] = [];
  const updated: unknown[] = [];
  const archived: unknown[] = [];
  const auditInserts: unknown[] = [];

  const service = {
    from: vi.fn((table: string) => {
      if (table === 'platform_roles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi
            .fn()
            .mockResolvedValue(
              handlers.platformRole ?? { data: { role: 'super_admin' }, error: null },
            ),
        };
      }
      if (table === 'leagues') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          // for .select('id', { count: 'exact', head: true }) → returns the count directly
          then: undefined,
          // emulate by overriding eq() to return the count object on resolution:
          // simpler: return the count via a final await — supabase chains resolve when awaited
        } as never;
      }
      if (table === 'league_scoring_systems') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          maybeSingle: vi
            .fn()
            .mockResolvedValue(handlers.systemById ?? { data: null, error: null }),
          insert: vi.fn((payload: unknown) => {
            inserted.push(payload);
            return {
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue(
                handlers.insertResult ?? {
                  data: { id: 'new-id', ...(payload as object) },
                  error: null,
                },
              ),
            };
          }),
          update: vi.fn((payload: unknown) => {
            updated.push(payload);
            const eqMock = vi.fn().mockReturnThis();
            const selectMock = vi.fn().mockReturnThis();
            const singleMock = vi.fn().mockResolvedValue(
              handlers.updateResult ?? {
                data: { id: 'sys-1', ...(payload as object) },
                error: null,
              },
            );
            // .update(...).eq(...).select(...).single() OR .update(...).eq(...) (archive)
            const chain: Record<string, unknown> = {
              eq: eqMock,
              select: selectMock,
              single: singleMock,
              then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
            };
            eqMock.mockReturnValue(chain);
            selectMock.mockReturnValue(chain);
            archived.push(payload);
            return chain;
          }),
        } as never;
      }
      if (table === 'audit_log') {
        return {
          insert: vi.fn((payload: unknown) => {
            auditInserts.push(payload);
            return Promise.resolve({ data: payload, error: null });
          }),
        };
      }
      return {} as never;
    }),
  };
  return { service: { service }, inserted, updated, archived, auditInserts };
}

function makeNonSuperAdminSupabase() {
  return buildSupabase({ platformRole: { data: null, error: null } });
}

describe('LeagueScoringSystemsService', () => {
  it('rejects non-super-admin callers on create', async () => {
    const { service } = makeNonSuperAdminSupabase();
    const svc = new LeagueScoringSystemsService(service as never);
    await expect(
      svc.create({ code: 'foo', name: 'Foo', pointsByRank: { '1': 10 } }, 'user-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('validates code format', async () => {
    const { service } = buildSupabase({});
    const svc = new LeagueScoringSystemsService(service as never);
    await expect(
      svc.create({ code: 'BadCode!', name: 'X', pointsByRank: { '1': 10 } }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects pointsByRank with no entries', async () => {
    const { service } = buildSupabase({});
    const svc = new LeagueScoringSystemsService(service as never);
    await expect(
      svc.create({ code: 'foo', name: 'X', pointsByRank: {} }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown tie-breakers', async () => {
    const { service } = buildSupabase({});
    const svc = new LeagueScoringSystemsService(service as never);
    await expect(
      svc.create(
        {
          code: 'foo',
          name: 'X',
          pointsByRank: { '1': 10 },
          tieBreakers: ['bogus_dimension'],
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('inserts a normalised row when validation passes', async () => {
    const { service, inserted } = buildSupabase({
      insertResult: {
        data: { id: 'sys-1', code: 'foo', name: 'Foo' },
        error: null,
      },
    });
    const svc = new LeagueScoringSystemsService(service as never);
    const row = await svc.create(
      {
        code: 'foo_2027',
        name: '  Foo 2027  ',
        pointsByRank: { '1': 50, '2': 40 },
        tieBreakers: ['total_points', 'medal_count'],
        description: 'desc',
      },
      'user-1',
    );
    expect(row.id).toBe('sys-1');
    expect(inserted).toEqual([
      expect.objectContaining({
        code: 'foo_2027',
        name: 'Foo 2027',
        is_builtin: false,
        is_archived: false,
        points_by_rank: { '1': 50, '2': 40 },
        tie_breakers: ['total_points', 'medal_count'],
        description: 'desc',
        created_by_user_id: 'user-1',
      }),
    ]);
  });

  it('translates duplicate-key inserts into ConflictException', async () => {
    const { service } = buildSupabase({
      insertResult: { data: null, error: { message: 'duplicate key violates unique constraint' } },
    });
    const svc = new LeagueScoringSystemsService(service as never);
    await expect(
      svc.create({ code: 'foo', name: 'X', pointsByRank: { '1': 10 } }, 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('writes a league.scoring_system.created audit row on successful create', async () => {
    const { service, auditInserts } = buildSupabase({
      insertResult: {
        data: { id: 'sys-1', code: 'foo_2027', name: 'Foo 2027' },
        error: null,
      },
    });
    const svc = new LeagueScoringSystemsService(service as never);
    await svc.create({ code: 'foo_2027', name: 'Foo 2027', pointsByRank: { '1': 10 } }, 'user-1');
    expect(auditInserts).toEqual([
      expect.objectContaining({
        actor_user_id: 'user-1',
        action: 'league.scoring_system.created',
        entity_type: 'league_scoring_system',
        entity_id: 'sys-1',
      }),
    ]);
  });

  it('refuses to update a built-in row', async () => {
    const { service } = buildSupabase({
      systemById: {
        data: { id: 'sys-1', is_builtin: true, code: 'ffamhe_tf_2026' },
        error: null,
      },
    });
    const svc = new LeagueScoringSystemsService(service as never);
    await expect(svc.update('sys-1', { name: 'Renamed' }, 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // ── Clone behaviour (Slice A) ─────────────────────────────────────────────

  it('clones the built-in into an editable variant', async () => {
    const ffamhe = {
      id: 'sys-builtin',
      code: 'ffamhe_tf_2026',
      name: 'FFAMHE TF 2026',
      is_builtin: true,
      points_by_rank: { '1': 16, '2': 13 },
      tie_breakers: ['total_points', 'medal_count'],
      description: 'Official FFAMHE.',
    };
    const { service, inserted, auditInserts } = buildCloneSupabase({
      source: ffamhe,
      existingCodes: new Set<string>(),
    });
    const svc = new LeagueScoringSystemsService(service as never);
    const cloned = await svc.clone('sys-builtin', 'user-1');
    expect(cloned.code).toBe('ffamhe_tf_2026_copy');
    expect(cloned.name).toBe('FFAMHE TF 2026 (copy)');
    expect(cloned.is_builtin).toBe(false);
    expect(cloned.is_archived).toBe(false);
    expect(cloned.points_by_rank).toEqual({ '1': 16, '2': 13 });
    expect(cloned.tie_breakers).toEqual(['total_points', 'medal_count']);
    expect(inserted[0]).toMatchObject({
      code: 'ffamhe_tf_2026_copy',
      name: 'FFAMHE TF 2026 (copy)',
      is_builtin: false,
      is_archived: false,
      created_by_user_id: 'user-1',
    });
    expect(auditInserts[0]).toMatchObject({
      action: 'league.scoring_system.cloned',
      entity_id: cloned.id,
      payload_json: expect.objectContaining({ source_code: 'ffamhe_tf_2026' }),
    });
  });

  it('clones a non-builtin row', async () => {
    const source = {
      id: 'sys-custom',
      code: 'wma_cup_2025',
      name: 'WMA Cup 2025',
      is_builtin: false,
      points_by_rank: { '1': 20, '2': 15 },
      tie_breakers: ['total_points'],
      description: null,
    };
    const { service } = buildCloneSupabase({ source, existingCodes: new Set() });
    const svc = new LeagueScoringSystemsService(service as never);
    const cloned = await svc.clone('sys-custom', 'user-1');
    expect(cloned.code).toBe('wma_cup_2025_copy');
    expect(cloned.is_builtin).toBe(false);
  });

  it('suffixes the cloned code when the base copy already exists', async () => {
    const source = {
      id: 'sys-1',
      code: 'foo',
      name: 'Foo',
      is_builtin: false,
      points_by_rank: { '1': 10 },
      tie_breakers: ['total_points'],
      description: null,
    };
    const { service } = buildCloneSupabase({
      source,
      existingCodes: new Set(['foo_copy', 'foo_copy_2']),
    });
    const svc = new LeagueScoringSystemsService(service as never);
    const cloned = await svc.clone('sys-1', 'user-1');
    expect(cloned.code).toBe('foo_copy_3');
  });

  it('rejects non-super-admin callers on clone', async () => {
    const { service } = makeNonSuperAdminSupabase();
    const svc = new LeagueScoringSystemsService(service as never);
    await expect(svc.clone('sys-1', 'user-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── Restore behaviour (Slice A) ───────────────────────────────────────────

  it('restores an archived row', async () => {
    const { service, updated, auditInserts } = buildSupabase({
      systemById: {
        data: {
          id: 'sys-2',
          code: 'foo',
          name: 'Foo',
          is_builtin: false,
          is_archived: true,
        },
        error: null,
      },
      updateResult: {
        data: { id: 'sys-2', code: 'foo', name: 'Foo', is_archived: false },
        error: null,
      },
    });
    const svc = new LeagueScoringSystemsService(service as never);
    const row = await svc.restore('sys-2', 'user-1');
    expect(row.is_archived).toBe(false);
    expect(updated[0]).toMatchObject({ is_archived: false });
    expect(auditInserts[0]).toMatchObject({
      action: 'league.scoring_system.restored',
      entity_id: 'sys-2',
    });
  });

  it('rejects non-super-admin callers on restore', async () => {
    const { service } = makeNonSuperAdminSupabase();
    const svc = new LeagueScoringSystemsService(service as never);
    await expect(svc.restore('sys-1', 'user-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── includeArchived listing (Slice A) ─────────────────────────────────────

  it('list({ includeArchived: false }) filters archived rows', async () => {
    const captured: { filterApplied: boolean } = { filterApplied: false };
    const service = {
      service: {
        from: vi.fn((table: string) => {
          if (table === 'league_scoring_systems') {
            const eqMock = vi.fn(() => {
              captured.filterApplied = true;
              return chain;
            });
            const orderMock = vi.fn().mockReturnThis();
            const chain: Record<string, unknown> = {
              eq: eqMock,
              order: orderMock,
              then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
                resolve({ data: [], error: null }),
            };
            return { select: vi.fn().mockReturnValue(chain) };
          }
          return {} as never;
        }),
      },
    };
    const svc = new LeagueScoringSystemsService(service as never);
    await svc.list({ includeArchived: false });
    expect(captured.filterApplied).toBe(true);
  });

  it('list({ includeArchived: true }) skips the archived filter', async () => {
    const captured: { filterApplied: boolean } = { filterApplied: false };
    const service = {
      service: {
        from: vi.fn((table: string) => {
          if (table === 'league_scoring_systems') {
            const eqMock = vi.fn(() => {
              captured.filterApplied = true;
              return chain;
            });
            const orderMock = vi.fn().mockReturnThis();
            const chain: Record<string, unknown> = {
              eq: eqMock,
              order: orderMock,
              then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
                resolve({ data: [], error: null }),
            };
            return { select: vi.fn().mockReturnValue(chain) };
          }
          return {} as never;
        }),
      },
    };
    const svc = new LeagueScoringSystemsService(service as never);
    await svc.list({ includeArchived: true });
    expect(captured.filterApplied).toBe(false);
  });

  // ── Versioning behaviour (Slice F.2) ──────────────────────────────────────

  describe('bumpPatch', () => {
    it('bumps the patch component', () => {
      expect(bumpPatch('1.0.0')).toBe('1.0.1');
      expect(bumpPatch('2.3.4')).toBe('2.3.5');
    });

    it('falls back to 1.0.1 on malformed input', () => {
      expect(bumpPatch('not-a-version')).toBe('1.0.1');
      expect(bumpPatch('')).toBe('1.0.1');
      expect(bumpPatch(null)).toBe('1.0.1');
    });
  });

  it('update() bumps version and snapshots the new version', async () => {
    const existing = {
      id: 'sys-1',
      code: 'foo',
      name: 'Foo',
      version: '1.0.0',
      is_builtin: false,
      points_by_rank: { '1': 10 },
      tie_breakers: ['total_points'],
      description: null,
    };
    const { service, updated, versionInserts } = buildVersioningSupabase({
      sourceRow: existing,
      updateResult: {
        ...existing,
        version: '1.0.1',
        name: 'Foo Updated',
      },
      versionsExistingProbe: { data: null, error: null },
    });
    const svc = new LeagueScoringSystemsService(service as never);
    const result = await svc.update('sys-1', { name: 'Foo Updated' }, 'user-1');
    expect(result.version).toBe('1.0.1');
    expect(updated[0]).toMatchObject({ version: '1.0.1', name: 'Foo Updated' });
    expect(versionInserts[0]).toMatchObject({
      league_scoring_system_id: 'sys-1',
      version: '1.0.1',
      name: 'Foo Updated',
      published_by_user_id: 'user-1',
    });
  });

  it('listVersions() returns the versions sorted newest-first', async () => {
    const versions = [
      {
        id: 'v-2',
        league_scoring_system_id: 'sys-1',
        version: '1.0.1',
        published_at: '2026-06-02T00:00:00Z',
      },
      {
        id: 'v-1',
        league_scoring_system_id: 'sys-1',
        version: '1.0.0',
        published_at: '2026-06-01T00:00:00Z',
      },
    ];
    const service = {
      service: {
        from: vi.fn((table: string) => {
          if (table === 'league_scoring_system_versions') {
            const chain: Record<string, unknown> = {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn(() => ({
                then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
                  resolve({ data: versions, error: null }),
              })),
            };
            return chain;
          }
          return {} as never;
        }),
      },
    };
    const svc = new LeagueScoringSystemsService(service as never);
    const result = await svc.listVersions('sys-1');
    expect(result).toHaveLength(2);
    expect(result[0]?.version).toBe('1.0.1');
    expect(result[1]?.version).toBe('1.0.0');
  });

  it('rollback() applies the target version values and bumps the current version', async () => {
    const existing = {
      id: 'sys-1',
      code: 'foo',
      name: 'Foo Current',
      version: '1.0.2',
      is_builtin: false,
      points_by_rank: { '1': 10, '2': 5 },
      tie_breakers: ['total_points'],
      description: null,
    };
    const target = {
      id: 'v-1',
      league_scoring_system_id: 'sys-1',
      version: '1.0.0',
      name: 'Foo Original',
      points_by_rank: { '1': 16, '2': 13 },
      tie_breakers: ['total_points', 'medal_count'],
      description: 'Original',
      published_at: '2026-05-01T00:00:00Z',
      published_by_user_id: 'user-x',
    };
    const { service, updated, versionInserts } = buildRollbackSupabase({
      sourceRow: existing,
      targetVersion: target,
      updateResult: {
        ...existing,
        version: '1.0.3',
        name: 'Foo Original',
        points_by_rank: { '1': 16, '2': 13 },
        tie_breakers: ['total_points', 'medal_count'],
        description: 'Original',
      },
    });
    const svc = new LeagueScoringSystemsService(service as never);
    const result = await svc.rollback('sys-1', 'v-1', 'user-1');
    expect(result.version).toBe('1.0.3');
    expect(result.name).toBe('Foo Original');
    expect(result.points_by_rank).toEqual({ '1': 16, '2': 13 });
    expect(updated[0]).toMatchObject({
      version: '1.0.3',
      name: 'Foo Original',
      points_by_rank: { '1': 16, '2': 13 },
    });
    expect(versionInserts[0]).toMatchObject({
      league_scoring_system_id: 'sys-1',
      version: '1.0.3',
    });
  });

  it('rollback() rejects built-in rows', async () => {
    const builtin = {
      id: 'sys-builtin',
      code: 'ffamhe_tf_2026',
      name: 'FFAMHE',
      version: '1.0.0',
      is_builtin: true,
      points_by_rank: { '1': 16 },
      tie_breakers: ['total_points'],
      description: null,
    };
    const { service } = buildSupabase({
      systemById: { data: builtin, error: null },
    });
    const svc = new LeagueScoringSystemsService(service as never);
    await expect(svc.rollback('sys-builtin', 'v-1', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rollback() rejects non-super-admin callers', async () => {
    const { service } = makeNonSuperAdminSupabase();
    const svc = new LeagueScoringSystemsService(service as never);
    await expect(svc.rollback('sys-1', 'v-1', 'user-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rollback() throws when the target version does not exist', async () => {
    const existing = {
      id: 'sys-1',
      code: 'foo',
      name: 'Foo',
      version: '1.0.0',
      is_builtin: false,
      points_by_rank: { '1': 10 },
      tie_breakers: ['total_points'],
      description: null,
    };
    const { service } = buildRollbackSupabase({
      sourceRow: existing,
      targetVersion: null,
      updateResult: existing,
    });
    const svc = new LeagueScoringSystemsService(service as never);
    await expect(svc.rollback('sys-1', 'missing-version', 'user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

// ── Clone-test helper: extends buildSupabase with code-existence lookup ─────

function buildCloneSupabase(opts: {
  source: {
    id: string;
    code: string;
    name: string;
    is_builtin: boolean;
    points_by_rank: Record<string, number>;
    tie_breakers: string[];
    description: string | null;
  };
  existingCodes: Set<string>;
}) {
  const inserted: unknown[] = [];
  const auditInserts: unknown[] = [];

  // Track how many maybeSingle() calls have been made on league_scoring_systems
  // so we can return the source row first (getById), then code-lookup results.
  let maybeSingleCallCount = 0;
  let pendingCodeLookup: string | null = null;

  const service = {
    from: vi.fn((table: string) => {
      if (table === 'platform_roles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'super_admin' }, error: null }),
        };
      }
      if (table === 'league_scoring_systems') {
        const eqMock = vi.fn((column: string, value: unknown) => {
          if (column === 'code') {
            pendingCodeLookup = String(value);
          }
          return chain;
        });
        const chain: Record<string, unknown> = {
          select: vi.fn().mockReturnThis(),
          eq: eqMock,
          maybeSingle: vi.fn(() => {
            maybeSingleCallCount += 1;
            // First call: getById(id) returns the source row
            if (maybeSingleCallCount === 1) {
              return Promise.resolve({ data: opts.source, error: null });
            }
            // Subsequent calls: code-existence lookup
            const code = pendingCodeLookup ?? '';
            const exists = opts.existingCodes.has(code);
            return Promise.resolve({ data: exists ? { id: 'taken' } : null, error: null });
          }),
          single: vi.fn((): Promise<Result> => {
            const inserts = inserted as Array<Record<string, unknown>>;
            const last = inserts[inserts.length - 1] ?? {};
            return Promise.resolve({
              data: { id: 'cloned-id', ...last },
              error: null,
            });
          }),
          insert: vi.fn((payload: unknown) => {
            inserted.push(payload);
            return chain;
          }),
        };
        return chain;
      }
      if (table === 'audit_log') {
        return {
          insert: vi.fn((payload: unknown) => {
            auditInserts.push(payload);
            return Promise.resolve({ data: payload, error: null });
          }),
        };
      }
      return {} as never;
    }),
  };
  return { service: { service }, inserted, auditInserts };
}

// ── Versioning-test helper for update() flow ────────────────────────────────

function buildVersioningSupabase(opts: {
  sourceRow: Record<string, unknown> & { id: string };
  updateResult: Record<string, unknown>;
  versionsExistingProbe: Result;
}) {
  const updated: unknown[] = [];
  const versionInserts: unknown[] = [];
  const auditInserts: unknown[] = [];

  // Track maybeSingle calls on league_scoring_systems to return source row
  // on the first call (getById) and pass-through otherwise.
  let systemsMaybeSingleCalls = 0;

  const service = {
    from: vi.fn((table: string) => {
      if (table === 'platform_roles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'super_admin' }, error: null }),
        };
      }
      if (table === 'league_scoring_systems') {
        const chain: Record<string, unknown> = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(() => {
            systemsMaybeSingleCalls += 1;
            if (systemsMaybeSingleCalls === 1) {
              return Promise.resolve({ data: opts.sourceRow, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          }),
          single: vi.fn().mockResolvedValue({ data: opts.updateResult, error: null }),
          update: vi.fn((payload: unknown) => {
            updated.push(payload);
            return chain;
          }),
        };
        return chain;
      }
      if (table === 'league_scoring_system_versions') {
        const chain: Record<string, unknown> = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue(opts.versionsExistingProbe),
          insert: vi.fn((payload: unknown) => {
            versionInserts.push(payload);
            return Promise.resolve({ data: payload, error: null });
          }),
        };
        return chain;
      }
      if (table === 'audit_log') {
        return {
          insert: vi.fn((payload: unknown) => {
            auditInserts.push(payload);
            return Promise.resolve({ data: payload, error: null });
          }),
        };
      }
      return {} as never;
    }),
  };
  return { service: { service }, updated, versionInserts, auditInserts };
}

// ── Versioning-test helper for rollback() flow ──────────────────────────────

function buildRollbackSupabase(opts: {
  sourceRow: Record<string, unknown> & { id: string; is_builtin: boolean };
  targetVersion: Record<string, unknown> | null;
  updateResult: Record<string, unknown>;
}) {
  const updated: unknown[] = [];
  const versionInserts: unknown[] = [];
  const auditInserts: unknown[] = [];

  let systemsMaybeSingleCalls = 0;
  let versionsMaybeSingleCalls = 0;

  const service = {
    from: vi.fn((table: string) => {
      if (table === 'platform_roles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'super_admin' }, error: null }),
        };
      }
      if (table === 'league_scoring_systems') {
        const chain: Record<string, unknown> = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(() => {
            systemsMaybeSingleCalls += 1;
            if (systemsMaybeSingleCalls === 1) {
              return Promise.resolve({ data: opts.sourceRow, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          }),
          single: vi.fn().mockResolvedValue({ data: opts.updateResult, error: null }),
          update: vi.fn((payload: unknown) => {
            updated.push(payload);
            return chain;
          }),
        };
        return chain;
      }
      if (table === 'league_scoring_system_versions') {
        const chain: Record<string, unknown> = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(() => {
            versionsMaybeSingleCalls += 1;
            // First call: target version lookup (in rollback)
            if (versionsMaybeSingleCalls === 1) {
              return Promise.resolve({ data: opts.targetVersion, error: null });
            }
            // Subsequent: snapshot probe (no existing snapshot for the new version)
            return Promise.resolve({ data: null, error: null });
          }),
          insert: vi.fn((payload: unknown) => {
            versionInserts.push(payload);
            return Promise.resolve({ data: payload, error: null });
          }),
        };
        return chain;
      }
      if (table === 'audit_log') {
        return {
          insert: vi.fn((payload: unknown) => {
            auditInserts.push(payload);
            return Promise.resolve({ data: payload, error: null });
          }),
        };
      }
      return {} as never;
    }),
  };
  return { service: { service }, updated, versionInserts, auditInserts };
}
