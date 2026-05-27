import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { LeagueScoringSystemsService } from './league-scoring-systems.service';

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
});
