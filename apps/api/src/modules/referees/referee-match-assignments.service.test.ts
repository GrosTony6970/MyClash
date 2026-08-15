/**
 * The query and the authorization. Row-to-payload mapping is tested against the
 * pure module in ./referee-match-assignments.test.ts.
 *
 * Chains are dispatched BY TABLE NAME rather than by call order. An ordered
 * `mockReturnValueOnce` sequence silently desyncs the moment a query is added or
 * reordered, and then asserts against the wrong response while still passing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { RefereeMatchAssignmentsService } from './referee-match-assignments.service';
import type { OrganizationsService } from '../organizations/organizations.service';
import type { SupabaseService } from '../supabase/supabase.service';

const fromMock = vi.fn();
const assertOrgRole = vi.fn();

/** A chain whose terminal `await` resolves to `result`. */
function chain(result: unknown) {
  const node: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const key of ['select', 'eq', 'in', 'limit', 'order']) {
    node[key] = vi.fn().mockReturnValue(node);
  }
  return node;
}

function makeService(tables: Record<string, unknown>): RefereeMatchAssignmentsService {
  fromMock.mockImplementation((table: string) => tables[table] ?? chain({ data: [], error: null }));
  return new RefereeMatchAssignmentsService(
    { service: { from: fromMock } } as unknown as SupabaseService,
    { assertOrgRole } as unknown as OrganizationsService,
  );
}

const EVENT_ROW = chain({ data: { organization_id: 'org-1' }, error: null });

/** `orgIdForEvent` reads through `.maybeSingle()`, unlike the list queries. */
function eventChain() {
  const node = EVENT_ROW as Record<string, unknown>;
  node['maybeSingle'] = vi
    .fn()
    .mockResolvedValue({ data: { organization_id: 'org-1' }, error: null });
  return node;
}

beforeEach(() => {
  fromMock.mockReset();
  assertOrgRole.mockReset();
  assertOrgRole.mockResolvedValue(undefined);
});

describe('RefereeMatchAssignmentsService', () => {
  it('requires organisation membership before reading anything', async () => {
    assertOrgRole.mockRejectedValue(new ForbiddenException('not a member'));
    const service = makeService({ events: eventChain() });

    await expect(service.getForEvent('event-1', 'user-9')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  /**
   * `read_only` is the floor of the hierarchy — any member. A higher bar would
   * hide the banner from the very people who staff the event, and a lower one
   * does not exist.
   */
  it('asserts the caller is a member at the read_only floor', async () => {
    const service = makeService({ events: eventChain() });

    await service.getForEvent('event-1', 'user-1');

    expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'read_only');
  });

  it('reads per-match assignments and the event-wide registration map', async () => {
    const service = makeService({
      events: eventChain(),
      referee_assignments: chain({
        data: [
          {
            match_id: 'm-1',
            role: 'head',
            global_persons: { id: 'gp-1', given_name: 'Ada', family_name: 'Lovelace' },
          },
        ],
        error: null,
      }),
      tournaments: chain({ data: [{ id: 't-1' }, { id: 't-2' }], error: null }),
      registrations: chain({
        data: [
          { id: 'reg-1', persons: { id: 'p-1', global_person_id: 'gp-1', given_name: 'Ada' } },
        ],
        error: null,
      }),
    });

    const payload = await service.getForEvent('event-1', 'user-1');

    expect(payload.assignments).toEqual([
      { matchId: 'm-1', personId: 'gp-1', personName: 'Ada Lovelace', role: 'head' },
    ]);
    expect(payload.registrations).toEqual([
      { registrationId: 'reg-1', personId: 'gp-1', personName: 'Ada' },
    ]);
  });

  /**
   * A referee crossing from one tournament's pool to another's bracket is the
   * case most likely to be missed by eye, so the registration map has to span
   * every tournament of the event rather than one.
   */
  it('scopes registrations to every tournament of the event', async () => {
    const registrations = chain({ data: [], error: null });
    const service = makeService({
      events: eventChain(),
      referee_assignments: chain({ data: [], error: null }),
      tournaments: chain({ data: [{ id: 't-1' }, { id: 't-2' }], error: null }),
      registrations,
    });

    await service.getForEvent('event-1', 'user-1');

    expect(registrations['in']).toHaveBeenCalledWith('tournament_id', ['t-1', 't-2']);
  });

  it('reads only per-match assignment rows, not the pool-scoped crew', async () => {
    const assignments = chain({ data: [], error: null });
    const service = makeService({
      events: eventChain(),
      referee_assignments: assignments,
      tournaments: chain({ data: [], error: null }),
    });

    await service.getForEvent('event-1', 'user-1');

    expect(assignments['eq']).toHaveBeenCalledWith('scope_type', 'match');
  });

  /**
   * The id-space rule, pinned at the QUERY rather than only at the mapper.
   * Dropping `global_person_id` from the select leaves the column undefined, the
   * mapper drops every row as unidentifiable, and the payload comes back empty —
   * so the board simply never warns and looks perfectly healthy. Nothing about
   * that failure is visible without this assertion.
   */
  it('projects global_person_id on the registration embed', async () => {
    const registrations = chain({ data: [], error: null });
    const service = makeService({
      events: eventChain(),
      referee_assignments: chain({ data: [], error: null }),
      tournaments: chain({ data: [{ id: 't-1' }], error: null }),
      registrations,
    });

    await service.getForEvent('event-1', 'user-1');

    expect(registrations['select']).toHaveBeenCalledWith(
      expect.stringContaining('global_person_id'),
    );
  });

  /** The other half of the same id-space: the referee side must embed
   *  `global_persons`, which is what `referee_assignments.person_id` points at. */
  it('embeds global_persons on the assignment side', async () => {
    const assignments = chain({ data: [], error: null });
    const service = makeService({
      events: eventChain(),
      referee_assignments: assignments,
      tournaments: chain({ data: [], error: null }),
    });

    await service.getForEvent('event-1', 'user-1');

    expect(assignments['select']).toHaveBeenCalledWith(expect.stringContaining('global_persons'));
  });

  it('skips the registration query for an event with no tournaments', async () => {
    const registrations = chain({ data: [], error: null });
    const service = makeService({
      events: eventChain(),
      referee_assignments: chain({ data: [], error: null }),
      tournaments: chain({ data: [], error: null }),
      registrations,
    });

    const payload = await service.getForEvent('event-1', 'user-1');

    expect(payload.registrations).toEqual([]);
    expect(registrations['select']).not.toHaveBeenCalled();
  });
});
