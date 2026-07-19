import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { BroadcastNotificationsService } from './broadcast-notifications.service';

function makeChain(result: unknown) {
  const chain = Object.assign(Promise.resolve(result), {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    insert: vi.fn(),
    update: vi.fn(),
  });
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  return chain;
}

function makeSupabase(resultsByTable: Record<string, unknown>) {
  return {
    service: {
      from: vi.fn((table: string) =>
        makeChain(resultsByTable[table] ?? { data: null, error: null }),
      ),
    },
  };
}

describe('BroadcastNotificationsService', () => {
  it('rejects non-organizers before sending a broadcast', async () => {
    const service = new BroadcastNotificationsService(
      makeSupabase({
        events: { data: { id: 'event-1', organization_id: 'org-1', slug: 'fal' }, error: null },
      }) as never,
      { assertOrgRole: vi.fn().mockRejectedValue(new ForbiddenException('no')) } as never,
      { sendImmediate: vi.fn() } as never,
    );

    await expect(
      service.sendBroadcast('event-1', 'actor-1', {
        targetType: 'all',
        severity: 'info',
        title: 'Pools ready',
        body: 'Check your pool now.',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects specific-person broadcasts without valid event persons', async () => {
    const service = new BroadcastNotificationsService(
      makeSupabase({
        events: { data: { id: 'event-1', organization_id: 'org-1', slug: 'fal' }, error: null },
        persons: { data: [], error: null },
      }) as never,
      { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
      { sendImmediate: vi.fn() } as never,
    );

    await expect(
      service.sendBroadcast('event-1', 'actor-1', {
        targetType: 'specific_persons',
        personIds: ['person-1'],
        severity: 'warning',
        title: 'Schedule change',
        body: 'Your match moved.',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists, dedupes, queues, and audits an all-event broadcast', async () => {
    const scheduler = { sendImmediate: vi.fn().mockResolvedValue(undefined) };
    const service = new BroadcastNotificationsService(
      makeSupabase({
        events: { data: { id: 'event-1', organization_id: 'org-1', slug: 'fal' }, error: null },
        persons: {
          data: [
            { id: 'person-1', claimed_by_user_id: 'user-1', email: 'one@example.com' },
            { id: 'person-2', claimed_by_user_id: 'user-1', email: 'one-alt@example.com' },
            { id: 'person-3', claimed_by_user_id: null, email: 'three@example.com' },
          ],
          error: null,
        },
        event_broadcast_notifications: {
          data: { id: 'broadcast-1', recipient_count: 2 },
          error: null,
        },
        event_broadcast_recipients: {
          data: [
            {
              id: 'recipient-1',
              broadcast_id: 'broadcast-1',
              person_id: 'person-1',
              user_id: 'user-1',
              email: 'one@example.com',
            },
            {
              id: 'recipient-2',
              broadcast_id: 'broadcast-1',
              person_id: 'person-3',
              user_id: null,
              email: 'three@example.com',
            },
          ],
          error: null,
        },
        audit_log: { data: { id: 'audit-1' }, error: null },
      }) as never,
      { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
      scheduler as never,
    );

    const result = await service.sendBroadcast('event-1', 'actor-1', {
      targetType: 'all',
      severity: 'alert',
      title: 'Venue change',
      body: 'Main hall closes now.',
    });

    expect(result).toEqual({ id: 'broadcast-1', recipientCount: 2 });
    expect(scheduler.sendImmediate).toHaveBeenCalledTimes(2);
    expect(scheduler.sendImmediate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'organizer_broadcast',
        entityId: 'broadcast-1',
        recipientId: 'recipient-1',
        userId: 'user-1',
        severity: 'alert',
      }),
    );
    expect(scheduler.sendImmediate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'organizer_broadcast',
        entityId: 'broadcast-1',
        recipientId: 'recipient-2',
        userId: 'recipient-2',
        forceEmail: true,
        email: 'three@example.com',
      }),
    );
  });

  it('resolves fighters from active registrations only', async () => {
    const from = vi.fn((table: string) => {
      const results: Record<string, unknown> = {
        events: { data: { id: 'event-1', organization_id: 'org-1', slug: 'fal' }, error: null },
        tournaments: { data: [{ id: 'tournament-1' }], error: null },
        registrations: {
          data: [{ person_id: 'person-1' }, { person_id: 'person-2' }],
          error: null,
        },
        persons: {
          data: [
            { id: 'person-1', claimed_by_user_id: 'user-1', email: 'one@example.com' },
            { id: 'person-2', claimed_by_user_id: null, email: 'two@example.com' },
          ],
          error: null,
        },
        event_broadcast_notifications: {
          data: { id: 'broadcast-1', recipient_count: 2 },
          error: null,
        },
        event_broadcast_recipients: {
          data: [
            {
              id: 'recipient-1',
              person_id: 'person-1',
              user_id: 'user-1',
              email: 'one@example.com',
            },
            { id: 'recipient-2', person_id: 'person-2', user_id: null, email: 'two@example.com' },
          ],
          error: null,
        },
        audit_log: { data: { id: 'audit-1' }, error: null },
      };
      return makeChain(results[table] ?? { data: null, error: null });
    });
    const scheduler = { sendImmediate: vi.fn().mockResolvedValue(undefined) };
    const service = new BroadcastNotificationsService(
      { service: { from } } as never,
      { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
      scheduler as never,
    );

    await service.sendBroadcast('event-1', 'actor-1', {
      targetType: 'fighters',
      severity: 'info',
      title: 'Pools ready',
      body: 'Pools are published.',
    });

    expect(from).toHaveBeenCalledWith('registrations');
    expect(scheduler.sendImmediate).toHaveBeenCalledTimes(2);
  });

  it('resolves tournament-scoped fighters and referees without notifying unrelated event people', async () => {
    const from = vi.fn((table: string) => {
      const results: Record<string, unknown> = {
        events: { data: { id: 'event-1', organization_id: 'org-1', slug: 'fal' }, error: null },
        tournaments: { data: [{ id: 'tournament-1' }], error: null },
        registrations: {
          data: [{ person_id: 'fighter-1' }, { person_id: 'fighter-2' }],
          error: null,
        },
        referee_assignments: {
          data: [
            { user_id: 'user-2', pool_id: 'pool-1', match_id: null },
            { user_id: 'user-1', pool_id: 'pool-1', match_id: null },
            { user_id: 'user-other', pool_id: 'pool-other', match_id: null },
          ],
          error: null,
        },
        phases: { data: [{ id: 'phase-1' }], error: null },
        pools: { data: [{ id: 'pool-1' }], error: null },
        matches: { data: [{ id: 'match-1' }], error: null },
        persons: {
          data: [
            { id: 'fighter-1', claimed_by_user_id: 'user-1', email: 'fighter@example.com' },
            { id: 'fighter-2', claimed_by_user_id: null, email: 'fighter2@example.com' },
            { id: 'referee-1', claimed_by_user_id: 'user-2', email: 'ref@example.com' },
          ],
          error: null,
        },
        event_broadcast_notifications: {
          data: { id: 'broadcast-1', recipient_count: 3 },
          error: null,
        },
        event_broadcast_recipients: {
          data: [
            {
              id: 'recipient-1',
              person_id: 'fighter-1',
              user_id: 'user-1',
              email: 'fighter@example.com',
            },
            {
              id: 'recipient-2',
              person_id: 'fighter-2',
              user_id: null,
              email: 'fighter2@example.com',
            },
            {
              id: 'recipient-3',
              person_id: 'referee-1',
              user_id: 'user-2',
              email: 'ref@example.com',
            },
          ],
          error: null,
        },
        audit_log: { data: { id: 'audit-1' }, error: null },
      };
      return makeChain(results[table] ?? { data: null, error: null });
    });
    const scheduler = { sendImmediate: vi.fn().mockResolvedValue(undefined) };
    const service = new BroadcastNotificationsService(
      { service: { from } } as never,
      { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
      scheduler as never,
    );

    await service.sendBroadcast('event-1', 'actor-1', {
      targetType: 'fighters_and_referees',
      tournamentId: 'tournament-1',
      severity: 'info',
      title: 'Pools ready',
      body: 'Pools are published.',
    });

    expect(scheduler.sendImmediate).toHaveBeenCalledTimes(3);
  });

  // ── sendToEventPersons — the instructor "Notify participants" path ────────────

  function instructorNotifyTables() {
    return {
      events: { data: { id: 'event-1', organization_id: 'org-1', slug: 'fal' }, error: null },
      persons: {
        data: [{ id: 'person-1', claimed_by_user_id: 'user-1', email: 'one@example.com' }],
        error: null,
      },
      event_broadcast_notifications: {
        data: { id: 'broadcast-1', recipient_count: 1 },
        error: null,
      },
      event_broadcast_recipients: {
        data: [
          {
            id: 'recipient-1',
            broadcast_id: 'broadcast-1',
            person_id: 'person-1',
            user_id: 'user-1',
            email: 'one@example.com',
          },
        ],
        error: null,
      },
      audit_log: { data: { id: 'audit-1' }, error: null },
    };
  }

  it('messages workshop enrollees without requiring an org-admin role', async () => {
    const scheduler = { sendImmediate: vi.fn().mockResolvedValue(undefined) };
    const assertOrgRole = vi.fn().mockRejectedValue(new ForbiddenException('not an org admin'));
    const service = new BroadcastNotificationsService(
      makeSupabase(instructorNotifyTables()) as never,
      { assertOrgRole } as never,
      scheduler as never,
    );

    const result = await service.sendToEventPersons(
      'event-1',
      'instructor-user',
      ['person-1'],
      'hello',
      'test',
    );

    // The caller (assertCanManageWorkshopAsInstructorOrLead) already authorized;
    // this path must NOT re-gate on org membership or instructors get a 403.
    expect(assertOrgRole).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'broadcast-1', recipientCount: 1 });
    expect(scheduler.sendImmediate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'organizer_broadcast',
        entityId: 'broadcast-1',
        recipientId: 'recipient-1',
        userId: 'user-1',
        severity: 'info',
      }),
    );
  });

  it('marks a recipient failed instead of failing the request when queueing throws', async () => {
    const chains: Record<string, ReturnType<typeof makeChain>> = {};
    const tables = instructorNotifyTables() as Record<string, unknown>;
    const from = vi.fn((table: string) => {
      // One chain per table so the update on event_broadcast_recipients is
      // observable after the call.
      chains[table] ??= makeChain(tables[table] ?? { data: null, error: null });
      return chains[table];
    });
    const scheduler = {
      sendImmediate: vi.fn().mockRejectedValue(new Error('Custom Id cannot contain :')),
    };
    const service = new BroadcastNotificationsService(
      { service: { from } } as never,
      { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
      scheduler as never,
    );

    const result = await service.sendToEventPersons(
      'event-1',
      'instructor-user',
      ['person-1'],
      'hello',
      'test',
    );

    expect(result).toEqual({ id: 'broadcast-1', recipientCount: 1 });
    expect(chains['event_broadcast_recipients']?.update).toHaveBeenCalledWith(
      expect.objectContaining({ delivery_status: 'failed' }),
    );
  });
});
