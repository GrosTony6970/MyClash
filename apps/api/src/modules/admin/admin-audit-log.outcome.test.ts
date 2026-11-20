import { describe, expect, it, vi } from 'vitest';
import { AdminAuditLogService } from './admin-audit-log.service';

/**
 * Ruling 914: each listed audit row carries its Result, from the one rule in `audit-outcome.ts`.
 * The rule's own cases are `audit-outcome.test.ts`; this holds the list to it. Its own file: the
 * service's test sits at the 400-line cap.
 */
function listingOf(rows: unknown[]) {
  const chain = Promise.resolve({ data: rows, error: null, count: rows.length });
  for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'range']) {
    Object.assign(chain, { [method]: vi.fn().mockReturnValue(chain) });
  }
  const supabase = { service: { from: vi.fn().mockReturnValue(chain) } };
  const labels = { resolve: vi.fn().mockResolvedValue({ labels: new Map(), users: new Map() }) };
  return new AdminAuditLogService(supabase as never, labels as never);
}

describe('the audit list', () => {
  it('gives a failed system action its outcome, and an ordinary row none', async () => {
    const service = listingOf([
      {
        id: 'a1',
        actor_user_id: null,
        action: 'system.component.restart',
        entity_type: 'system_component',
        entity_id: 'web-public',
        payload_json: { ok: false, exitCode: 1, timedOut: false },
        created_at: '2026-11-20T06:05:00.000Z',
      },
      {
        id: 'a2',
        actor_user_id: null,
        action: 'event.update',
        entity_type: 'event',
        entity_id: 'ev-1',
        payload_json: { ok: false },
        created_at: '2026-11-20T06:00:00.000Z',
      },
    ]);

    const { items } = await service.list({});

    expect(items.map((item) => item.outcome)).toEqual(['failed', null]);
  });
});
