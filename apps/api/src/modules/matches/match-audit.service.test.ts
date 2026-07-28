import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityLabelService } from '../entity-label/entity-label.service';
import { MatchAuditService } from './match-audit.service';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

const MATCH = '11111111-1111-4111-8111-111111111111';
const EXCHANGE = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const EVENT = '44444444-4444-4444-8444-444444444444';
const REQUESTER = '55555555-5555-4555-8555-555555555555';
const REVIEWER = '66666666-6666-4666-8666-666666666666';
/** Belongs to a different event entirely — must never be labelled here. */
const FOREIGN_MATCH = '99999999-9999-4999-8999-999999999999';

type Chain = Promise<{ data: unknown; error: unknown }> & Record<string, ReturnType<typeof vi.fn>>;

function chainOf(result: { data: unknown; error: unknown }): Chain {
  const chain = Promise.resolve(result) as Chain;
  for (const method of ['select', 'eq', 'in', 'or', 'order', 'limit', 'maybeSingle'] as const) {
    (chain as unknown as Record<string, unknown>)[method] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

describe('MatchAuditService', () => {
  let service: MatchAuditService;
  let resolveUsers: ReturnType<typeof vi.fn>;

  /** Declared keys stay non-optional so assertions don't need `?.` everywhere. */
  interface WiredTables extends Record<string, Chain> {
    matches: Chain;
    exchanges: Chain;
    exchange_edit_requests: Chain;
    audit_log: Chain;
  }

  function wire(auditRows: unknown[], tables: Record<string, Chain> = {}): WiredTables {
    const defaults: WiredTables = {
      matches: chainOf({ data: [{ id: MATCH, match_number_label: 'P1M1' }], error: null }),
      exchanges: chainOf({ data: [{ id: EXCHANGE }], error: null }),
      exchange_edit_requests: chainOf({
        data: [
          {
            id: REQUEST,
            event_id: EVENT,
            requested_by_user_id: REQUESTER,
            reviewed_by_user_id: REVIEWER,
          },
        ],
        error: null,
      }),
      audit_log: chainOf({ data: auditRows, error: null }),
      ...tables,
    };
    fromMock.mockImplementation((table: string) => {
      const chain = defaults[table];
      if (!chain) throw new Error(`Unexpected table: ${table}`);
      return chain;
    });
    return defaults;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resolveUsers = vi.fn().mockResolvedValue(
      new Map([
        [REQUESTER, { name: 'Org Editor', email: 'editor@club.test' }],
        [REVIEWER, { name: 'Platform Admin', email: 'root@myclash.test' }],
      ]),
    );
    const entityLabels = new EntityLabelService(mockSupabase as never, { resolveUsers } as never);
    service = new MatchAuditService(mockSupabase as never, entityLabels);
  });

  it("scopes the audit query to this match's own exchanges and requests", async () => {
    const tables = wire([]);
    await service.listForMatch(MATCH);

    expect(tables.exchanges.eq).toHaveBeenCalledWith('match_id', MATCH);
    expect(tables.exchange_edit_requests.eq).toHaveBeenCalledWith('match_id', MATCH);
    expect(tables.audit_log.or).toHaveBeenCalledWith(
      `and(entity_type.eq.exchange,entity_id.in.(${EXCHANGE})),and(entity_type.eq.exchange_edit_request,entity_id.in.(${REQUEST}))`,
    );
  });

  it('returns nothing without querying the audit log when the match has no history', async () => {
    const tables = wire([], {
      exchanges: chainOf({ data: [], error: null }),
      exchange_edit_requests: chainOf({ data: [], error: null }),
    });

    expect(await service.listForMatch(MATCH)).toEqual([]);
    expect(tables.audit_log.or).not.toHaveBeenCalled();
  });

  it('labels a reviewer by name and never leaks their email', async () => {
    // exchange_edit_request.approve embeds the whole request row, and the
    // reviewer is by definition a platform super-admin. An org editor may see
    // WHO approved their correction, not how to contact them.
    wire([
      {
        id: 'log-1',
        actor_user_id: REVIEWER,
        action: 'exchange_edit_request.approve',
        entity_type: 'exchange_edit_request',
        entity_id: REQUEST,
        payload_json: {
          request: {
            match_id: MATCH,
            requested_by_user_id: REQUESTER,
            reviewed_by_user_id: REVIEWER,
          },
        },
        created_at: '2026-05-03T10:00:00.000Z',
      },
    ]);

    const [entry] = await service.listForMatch(MATCH);

    expect(entry?.actorDisplayName).toBe('Platform Admin');
    expect(entry?.payloadLabels['/request/reviewed_by_user_id']).toEqual({
      label: 'Platform Admin',
      kind: 'user',
    });
    expect(JSON.stringify(entry)).not.toContain('root@myclash.test');
    expect(JSON.stringify(entry)).not.toContain('editor@club.test');
  });

  it('refuses to label an id that does not belong to this match', async () => {
    wire([
      {
        id: 'log-1',
        actor_user_id: REQUESTER,
        action: 'exchange_edit_request.create',
        entity_type: 'exchange_edit_request',
        entity_id: REQUEST,
        // A match id from a different event, smuggled into the payload.
        payload_json: { exchange: { id: EXCHANGE, match_id: FOREIGN_MATCH } },
        created_at: '2026-05-03T10:00:00.000Z',
      },
    ]);

    const [entry] = await service.listForMatch(MATCH);

    expect(entry?.payloadLabels['/exchange/match_id']).toBeUndefined();
    expect(fromMock).not.toHaveBeenCalledWith('matches_foreign');
    // The in-scope sibling in the very same payload still resolves.
    expect(Object.keys(entry?.payloadLabels ?? {})).toContain('/exchange/id');
  });

  it('degrades to an empty list rather than throwing when the audit read fails', async () => {
    wire([], { audit_log: chainOf({ data: null, error: { message: 'boom' } }) });
    await expect(service.listForMatch(MATCH)).resolves.toEqual([]);
  });

  it('clamps the limit', async () => {
    const tables = wire([]);
    await service.listForMatch(MATCH, 10_000);
    expect(tables.audit_log.limit).toHaveBeenCalledWith(200);
  });
});
