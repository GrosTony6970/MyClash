import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityLabelService } from '../entity-label/entity-label.service';
import { AdminAuditLogService } from './admin-audit-log.service';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

// Ids must be UUID-shaped: the resolver refuses to send anything else to the
// database, which is what keeps `entity_id: 'batch'` from raising 22P02.
const FIGHTER = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const ORG = '44444444-4444-4444-8444-444444444444';
const TARGET = '55555555-5555-4555-8555-555555555555';
const PERSON = '66666666-6666-4666-8666-666666666666';
const TOURNAMENT = '77777777-7777-4777-8777-777777777777';

type AwaitableChain = Promise<{ data: unknown; error: unknown; count?: number | null }> & {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
};

function makeAwaitableChain(result: {
  data: unknown;
  error: unknown;
  count?: number | null;
}): AwaitableChain {
  const chain = Promise.resolve(result) as AwaitableChain;
  for (const method of ['select', 'eq', 'gte', 'lte', 'in', 'order', 'range', 'limit'] as const) {
    (chain as unknown as Record<string, unknown>)[method] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

/** Route each table to its own chain; anything unexpected is a test bug. */
function routeTables(tables: Record<string, AwaitableChain>) {
  fromMock.mockImplementation((table: string) => {
    const chain = tables[table];
    if (!chain) throw new Error(`Unexpected table: ${table}`);
    return chain;
  });
}

function auditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    actor_user_id: ACTOR,
    action: 'fighter.merge',
    entity_type: 'fighter',
    entity_id: FIGHTER,
    payload_json: { reason: 'duplicate' },
    created_at: '2026-05-03T10:00:00.000Z',
    ...overrides,
  };
}

describe('AdminAuditLogService', () => {
  let service: AdminAuditLogService;
  let resolveUsers: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveUsers = vi.fn().mockResolvedValue(new Map());
    // A real EntityLabelService so the batching assertions mean something.
    const entityLabels = new EntityLabelService(mockSupabase as never, { resolveUsers } as never);
    service = new AdminAuditLogService(mockSupabase as never, entityLabels);
  });

  it('applies filters, clamps page size, returns pagination metadata, and enriches entityLabel', async () => {
    const auditChain = makeAwaitableChain({ data: [auditRow()], error: null, count: 151 });
    const fighterChain = makeAwaitableChain({
      data: [
        { id: FIGHTER, display_name: 'Alice Smith', given_name: 'Alice', family_name: 'Smith' },
      ],
      error: null,
    });
    routeTables({ audit_log: auditChain, global_persons: fighterChain });

    const result = await service.list({
      actor: ACTOR,
      action: 'fighter.merge',
      entityType: 'fighter',
      from: '2026-05-01',
      to: '2026-05-03',
      page: '2',
      perPage: '500',
    });

    expect(auditChain.select).toHaveBeenCalledWith(
      'id, actor_user_id, action, entity_type, entity_id, payload_json, created_at',
      { count: 'exact' },
    );
    expect(auditChain.eq).toHaveBeenCalledWith('actor_user_id', ACTOR);
    expect(auditChain.eq).toHaveBeenCalledWith('action', 'fighter.merge');
    expect(auditChain.eq).toHaveBeenCalledWith('entity_type', 'fighter');
    expect(auditChain.gte).toHaveBeenCalledWith('created_at', '2026-05-01');
    expect(auditChain.lte).toHaveBeenCalledWith('created_at', '2026-05-03');
    expect(auditChain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(auditChain.range).toHaveBeenCalledWith(100, 199);
    expect(fighterChain.in).toHaveBeenCalledWith('id', [FIGHTER]);
    expect(result).toEqual({
      items: [
        {
          id: 'log-1',
          actor_user_id: ACTOR,
          actorName: null,
          actorEmail: null,
          action: 'fighter.merge',
          entity_type: 'fighter',
          entity_id: FIGHTER,
          payload_json: { reason: 'duplicate' },
          created_at: '2026-05-03T10:00:00.000Z',
          entityLabel: 'Alice Smith',
          payloadLabels: {},
        },
      ],
      total: 151,
      page: 2,
      perPage: 100,
      totalPages: 2,
    });
  });

  it('resolves entityLabel per type and falls back to null for unknown types', async () => {
    const auditChain = makeAwaitableChain({
      data: [
        auditRow({
          id: 'log-evt',
          action: 'event.publish',
          entity_type: 'event',
          entity_id: EVENT,
          payload_json: null,
        }),
        auditRow({
          id: 'log-mystery',
          action: 'something.happened',
          entity_type: 'unmapped_type',
          entity_id: TARGET,
          payload_json: null,
        }),
      ],
      error: null,
      count: 2,
    });
    routeTables({
      audit_log: auditChain,
      events: makeAwaitableChain({ data: [{ id: EVENT, name: 'Spring Open 2026' }], error: null }),
    });

    const result = await service.list({});

    expect(result.items[0]).toMatchObject({
      entity_type: 'event',
      entityLabel: 'Spring Open 2026',
    });
    expect(result.items[1]).toMatchObject({ entity_type: 'unmapped_type', entityLabel: null });
  });

  // ── Regressions ────────────────────────────────────────────────────────────

  it('resolves an entity_type=user row through the user directory, never a users table', async () => {
    // There is no `public.users` table — fighters was renamed to global_persons
    // in 0023 and nothing ever created one. Querying it 400'd the whole page.
    const auditChain = makeAwaitableChain({
      data: [
        auditRow({
          action: 'user.update',
          entity_type: 'user',
          entity_id: TARGET,
          payload_json: null,
        }),
      ],
      error: null,
      count: 1,
    });
    routeTables({ audit_log: auditChain });
    resolveUsers.mockResolvedValue(
      new Map([
        [TARGET, { name: 'Ada Lovelace', email: 'ada@example.test' }],
        [ACTOR, { name: 'Root Admin', email: 'root@example.test' }],
      ]),
    );

    const result = await service.list({});

    expect(fromMock).not.toHaveBeenCalledWith('users');
    expect(result.items[0]).toMatchObject({
      entityLabel: 'Ada Lovelace',
      actorName: 'Root Admin',
    });
  });

  it('degrades to a raw id when one kind fails, instead of failing the whole list', async () => {
    const auditChain = makeAwaitableChain({
      data: [
        auditRow({ id: 'a', entity_type: 'event', entity_id: EVENT, payload_json: null }),
        auditRow({ id: 'b', entity_type: 'organization', entity_id: ORG, payload_json: null }),
      ],
      error: null,
      count: 2,
    });
    routeTables({
      audit_log: auditChain,
      events: makeAwaitableChain({ data: null, error: { message: 'relation does not exist' } }),
      organizations: makeAwaitableChain({ data: [{ id: ORG, name: 'Lyon HEMA' }], error: null }),
    });

    const result = await service.list({});

    expect(result.items[0]).toMatchObject({ entityLabel: null });
    expect(result.items[1]).toMatchObject({ entityLabel: 'Lyon HEMA' });
  });

  it('never queries a table for a non-UUID entity_id', async () => {
    // clubs.service writes the literal 'batch' for its bulk actions.
    const auditChain = makeAwaitableChain({
      data: [auditRow({ action: 'club.bulk_archive', entity_type: 'club', entity_id: 'batch' })],
      error: null,
      count: 1,
    });
    routeTables({ audit_log: auditChain });

    const result = await service.list({});

    expect(fromMock).not.toHaveBeenCalledWith('clubs');
    expect(result.items[0]).toMatchObject({ entityLabel: null });
  });

  it('keeps labels apart when two entity types share an id value', async () => {
    // The old resolver keyed its map by id alone, so these clobbered each other.
    const shared = EVENT;
    const auditChain = makeAwaitableChain({
      data: [
        auditRow({ id: 'a', entity_type: 'event', entity_id: shared, payload_json: null }),
        auditRow({ id: 'b', entity_type: 'organization', entity_id: shared, payload_json: null }),
      ],
      error: null,
      count: 2,
    });
    routeTables({
      audit_log: auditChain,
      events: makeAwaitableChain({ data: [{ id: shared, name: 'Spring Open' }], error: null }),
      organizations: makeAwaitableChain({ data: [{ id: shared, name: 'Lyon HEMA' }], error: null }),
    });

    const result = await service.list({});

    expect(result.items[0]?.entityLabel).toBe('Spring Open');
    expect(result.items[1]?.entityLabel).toBe('Lyon HEMA');
  });

  // ── payload_json ───────────────────────────────────────────────────────────

  it('labels ids nested in payload_json without altering payload_json itself', async () => {
    const payload = {
      source: { id: FIGHTER },
      target: { id: TARGET },
      moved: { personIds: [PERSON] },
      reason: 'duplicate',
    };
    const auditChain = makeAwaitableChain({
      data: [auditRow({ payload_json: payload })],
      error: null,
      count: 1,
    });
    routeTables({
      audit_log: auditChain,
      global_persons: makeAwaitableChain({
        data: [
          { id: FIGHTER, display_name: 'Alice Smith' },
          { id: TARGET, display_name: 'A. Smith (dup)' },
        ],
        error: null,
      }),
      persons: makeAwaitableChain({
        data: [{ id: PERSON, given_name: 'Alice', family_name: 'Smith' }],
        error: null,
      }),
    });

    const result = await service.list({});

    expect(result.items[0]?.payloadLabels).toEqual({
      '/source/id': { label: 'Alice Smith', kind: 'global_person' },
      '/target/id': { label: 'A. Smith (dup)', kind: 'global_person' },
      '/moved/personIds/0': { label: 'Alice Smith', kind: 'person' },
    });
    // Byte-identical: the audit log is a forensic record, so the raw ids stay.
    expect(result.items[0]?.payload_json).toEqual(payload);
  });

  it('batches one query per kind and dedupes ids across rows', async () => {
    const auditChain = makeAwaitableChain({
      data: [
        auditRow({ id: 'a', action: 'org.update', payload_json: { organization_id: ORG } }),
        auditRow({ id: 'b', action: 'org.update', payload_json: { organization_id: ORG } }),
        auditRow({ id: 'c', action: 'x', payload_json: { eventId: EVENT } }),
      ],
      error: null,
      count: 3,
    });
    const orgChain = makeAwaitableChain({ data: [{ id: ORG, name: 'Lyon HEMA' }], error: null });
    const eventChain = makeAwaitableChain({
      data: [{ id: EVENT, name: 'Spring Open' }],
      error: null,
    });
    routeTables({
      audit_log: auditChain,
      organizations: orgChain,
      events: eventChain,
      global_persons: makeAwaitableChain({ data: [], error: null }),
    });

    await service.list({});

    expect(fromMock.mock.calls.filter(([t]) => t === 'organizations')).toHaveLength(1);
    expect(fromMock.mock.calls.filter(([t]) => t === 'events')).toHaveLength(1);
    expect(orgChain.in).toHaveBeenCalledWith('id', [ORG]);
  });

  it('resolves an action-scoped payload key against the right table', async () => {
    const auditChain = makeAwaitableChain({
      data: [
        auditRow({
          action: 'archive_restore_tournament',
          entity_type: 'tournament',
          entity_id: TOURNAMENT,
          payload_json: { sourceId: TOURNAMENT, mode: 'copy' },
        }),
      ],
      error: null,
      count: 1,
    });
    routeTables({
      audit_log: auditChain,
      tournaments: makeAwaitableChain({
        data: [{ id: TOURNAMENT, name: 'Longsword Open' }],
        error: null,
      }),
    });

    const result = await service.list({});

    expect(fromMock).not.toHaveBeenCalledWith('events');
    expect(result.items[0]?.payloadLabels).toEqual({
      '/sourceId': { label: 'Longsword Open', kind: 'tournament' },
    });
  });

  // ── Export ─────────────────────────────────────────────────────────────────

  it('exports filtered rows as escaped CSV capped at 5000 rows', async () => {
    const chain = makeAwaitableChain({
      data: [
        {
          created_at: '2026-05-03T10:00:00.000Z',
          actor_user_id: 'actor,1',
          action: 'feature_flag.upsert',
          entity_type: 'feature_flag',
          entity_id: 'flag"one',
          payload_json: { text: 'line\nbreak' },
        },
      ],
      error: null,
    });
    fromMock.mockReturnValue(chain);

    const csv = await service.exportCsv({
      action: 'feature_flag.upsert',
      entityType: 'feature_flag',
    });

    expect(chain.eq).toHaveBeenCalledWith('action', 'feature_flag.upsert');
    expect(chain.eq).toHaveBeenCalledWith('entity_type', 'feature_flag');
    expect(chain.limit).toHaveBeenCalledWith(5000);
    // Unchanged on purpose: the export stays id-only, so a downloaded file
    // carries no more identity than it did before.
    expect(csv).toBe(
      [
        'created_at,actor_user_id,action,entity_type,entity_id,payload_json',
        '2026-05-03T10:00:00.000Z,"actor,1",feature_flag.upsert,feature_flag,"flag""one","{""text"":""line\\nbreak""}"',
      ].join('\n'),
    );
  });

  it('rejects invalid date filters', async () => {
    await expect(service.list({ from: 'not-a-date' })).rejects.toThrow(BadRequestException);
    expect(fromMock).not.toHaveBeenCalled();
  });
});
