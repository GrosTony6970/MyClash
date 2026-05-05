import { ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ArchiveService } from './archive.service';

type TableRows = Record<string, Record<string, unknown>[]>;

function makeSupabase(rows: TableRows) {
  const inserted: Record<string, Record<string, unknown>[]> = {};
  const from = vi.fn((table: string) => {
    const tableRows = rows[table] ?? [];
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((column: string, value: unknown) => {
        chain.current = chain.current.filter((row) => row[column] === value);
        return chain;
      }),
      in: vi.fn((column: string, values: unknown[]) => {
        chain.current = chain.current.filter((row) => values.includes(row[column]));
        return chain;
      }),
      order: vi.fn(() => chain),
      insert: vi.fn((payload: Record<string, unknown> | Record<string, unknown>[]) => {
        const items = Array.isArray(payload) ? payload : [payload];
        inserted[table] = [...(inserted[table] ?? []), ...items];
        chain.current = items;
        return chain;
      }),
      maybeSingle: vi.fn(() =>
        Promise.resolve({
          data: chain.current[0] ?? null,
          error: null as { message: string } | null,
        }),
      ),
      single: vi.fn(() =>
        Promise.resolve({
          data: chain.current[0] ?? null,
          error: null as { message: string } | null,
        }),
      ),
      current: [...tableRows],
      then: undefined as unknown,
    };
    Object.defineProperty(chain, 'then', {
      value: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve(resolve({ data: chain.current, error: null })),
      enumerable: false,
    });
    return chain;
  });

  return {
    supabase: { service: { from, rpc: vi.fn(() => Promise.resolve({ data: null, error: null })) } },
    inserted,
  };
}

function makeService(rows: TableRows = {}) {
  const { supabase, inserted } = makeSupabase(rows);
  const orgs = { assertOrgRole: vi.fn(() => Promise.resolve()) };
  return {
    service: new ArchiveService(supabase as never, orgs as never),
    orgs,
    inserted,
  };
}

describe('ArchiveService', () => {
  it('requires organization admin access before returning an event archive', async () => {
    const { service, orgs } = makeService({
      events: [
        { id: 'event-1', organization_id: 'org-1', slug: 'fal', name: 'FAL', status: 'draft' },
      ],
    });
    orgs.assertOrgRole.mockRejectedValueOnce(new ForbiddenException('nope'));

    await expect(
      service.generateEventArchive('event-1', 'user-1', { include: 'structure' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
  });

  it('exports event structure and scoring data as a stable MyClash archive', async () => {
    const { service } = makeService({
      events: [
        { id: 'event-1', organization_id: 'org-1', slug: 'fal', name: 'FAL', status: 'draft' },
      ],
      tournaments: [
        { id: 'tournament-1', event_id: 'event-1', slug: 'longsword', name: 'Longsword' },
      ],
      persons: [
        {
          id: 'person-1',
          event_id: 'event-1',
          given_name: 'Anne',
          family_name: 'Smith',
          email: 'a@example.test',
        },
      ],
      registrations: [{ id: 'reg-1', tournament_id: 'tournament-1', person_id: 'person-1' }],
      phases: [{ id: 'phase-1', tournament_id: 'tournament-1', type: 'pool' }],
      pools: [{ id: 'pool-1', phase_id: 'phase-1', name: 'Pool 1' }],
      matches: [
        { id: 'match-1', tournament_id: 'tournament-1', phase_id: 'phase-1', status: 'completed' },
      ],
      exchanges: [
        {
          id: 'exchange-1',
          match_id: 'match-1',
          client_uuid: 'client-1',
          sequence: 1,
          type: 'clean',
        },
      ],
      match_events: [{ id: 'event-row-1', match_id: 'match-1', sequence: 1, type: 'start' }],
    });

    const archive = await service.generateEventArchive('event-1', 'user-1', { include: 'scoring' });

    expect(archive.manifest).toBe('myclash.archive.v1');
    expect(archive.scope).toBe('event');
    expect(archive.include).toBe('scoring');
    expect(archive.data.events).toHaveLength(1);
    expect(archive.data.tournaments).toHaveLength(1);
    expect(archive.data.matches).toHaveLength(1);
    expect(archive.data.exchanges).toHaveLength(1);
    expect(archive.reports.tournaments[0]?.resultsCsv).toContain('match_label');
  });

  it('excludes scoring rows from structure-only archives', async () => {
    const { service } = makeService({
      events: [
        { id: 'event-1', organization_id: 'org-1', slug: 'fal', name: 'FAL', status: 'draft' },
      ],
      tournaments: [
        { id: 'tournament-1', event_id: 'event-1', slug: 'longsword', name: 'Longsword' },
      ],
      phases: [{ id: 'phase-1', tournament_id: 'tournament-1', type: 'pool' }],
      matches: [
        { id: 'match-1', tournament_id: 'tournament-1', phase_id: 'phase-1', status: 'completed' },
      ],
      exchanges: [
        {
          id: 'exchange-1',
          match_id: 'match-1',
          client_uuid: 'client-1',
          sequence: 1,
          type: 'clean',
        },
      ],
    });

    const archive = await service.generateEventArchive('event-1', 'user-1', {
      include: 'structure',
    });

    expect(archive.data.matches).toHaveLength(0);
    expect(archive.data.exchanges).toHaveLength(0);
  });

  it('exports tournament CSV reports with escaped values', async () => {
    const { service } = makeService({
      tournaments: [
        { id: 'tournament-1', event_id: 'event-1', slug: 'longsword', name: 'Longsword' },
      ],
      events: [
        { id: 'event-1', organization_id: 'org-1', slug: 'fal', name: 'FAL', status: 'draft' },
      ],
      registrations: [
        { id: 'red-reg', tournament_id: 'tournament-1', person_id: 'red-person' },
        { id: 'blue-reg', tournament_id: 'tournament-1', person_id: 'blue-person' },
      ],
      phases: [{ id: 'phase-1', tournament_id: 'tournament-1', type: 'pool' }],
      persons: [
        {
          id: 'red-person',
          event_id: 'event-1',
          given_name: 'Anne',
          family_name: 'Smith',
          email: 'a@example.test',
        },
        {
          id: 'blue-person',
          event_id: 'event-1',
          given_name: 'Bob',
          family_name: 'Club, Jr.',
          email: 'b@example.test',
        },
      ],
      matches: [
        {
          id: 'match-1',
          phase_id: 'phase-1',
          red_registration_id: 'red-reg',
          blue_registration_id: 'blue-reg',
          red_score: 5,
          blue_score: 3,
          status: 'completed',
          match_number_label: 'Final',
        },
      ],
      exchanges: [
        {
          id: 'exchange-1',
          match_id: 'match-1',
          sequence: 1,
          type: 'clean',
          first_striker_color: 'red',
        },
      ],
    });

    const reports = await service.generateTournamentCsvReports('tournament-1', 'user-1');

    expect(reports.resultsCsv).toContain('"Bob Club, Jr."');
    expect(reports.matchesCsv).toContain('Final');
    expect(reports.exchangesCsv).toContain('first_striker');
    expect(reports.rankingsCsv).toContain('rank,name');
  });

  it('rejects unsupported archives during restore preview', async () => {
    const { service } = makeService();

    await expect(
      service.previewRestore(Buffer.from(JSON.stringify({ manifest: 'something-else' })), 'user-1'),
    ).rejects.toThrow('Unsupported archive format');
  });

  it('blocks copy restore from an archive captured while the source was running', async () => {
    const { service } = makeService({
      events: [
        {
          id: 'target-event',
          organization_id: 'org-1',
          slug: 'target',
          name: 'Target',
          status: 'draft',
        },
      ],
    });
    const archive = {
      manifest: 'myclash.archive.v1',
      version: 1,
      generatedAt: new Date().toISOString(),
      scope: 'event',
      include: 'structure',
      source: { eventId: 'event-1', eventSlug: 'fal', eventName: 'FAL', eventStatus: 'running' },
      data: {
        events: [
          { id: 'event-1', organization_id: 'org-1', slug: 'fal', name: 'FAL', status: 'running' },
        ],
      },
      reports: { tournaments: [] },
    };

    await expect(
      service.restoreArchiveCopy(Buffer.from(JSON.stringify(archive)), 'user-1', {
        confirmation: 'RESTORE MYCLASH ARCHIVE',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires an exact confirmation phrase before restore', async () => {
    const { service } = makeService({
      events: [
        {
          id: 'target-event',
          organization_id: 'org-1',
          slug: 'target',
          name: 'Target',
          status: 'draft',
        },
      ],
    });
    const archive = {
      manifest: 'myclash.archive.v1',
      version: 1,
      generatedAt: new Date().toISOString(),
      scope: 'event',
      include: 'structure',
      source: { eventId: 'event-1', eventSlug: 'fal', eventName: 'FAL', eventStatus: 'completed' },
      data: {
        events: [
          {
            id: 'event-1',
            organization_id: 'org-1',
            slug: 'fal',
            name: 'FAL',
            status: 'completed',
          },
        ],
      },
      reports: { tournaments: [] },
    };

    await expect(
      service.restoreArchiveCopy(Buffer.from(JSON.stringify(archive)), 'user-1', {
        targetOrganizationId: 'org-1',
        confirmation: 'wrong',
      }),
    ).rejects.toThrow('confirmation');
  });

  it('copies an event archive with new root identifiers', async () => {
    const { service, inserted } = makeService({
      events: [
        {
          id: 'existing',
          organization_id: 'org-1',
          slug: 'target',
          name: 'Target',
          status: 'draft',
        },
      ],
    });
    const archive = {
      manifest: 'myclash.archive.v1',
      version: 1,
      generatedAt: new Date().toISOString(),
      scope: 'event',
      include: 'structure',
      source: { eventId: 'event-1', eventSlug: 'fal', eventName: 'FAL', eventStatus: 'completed' },
      data: {
        events: [
          {
            id: 'event-1',
            organization_id: 'org-1',
            slug: 'fal',
            name: 'FAL',
            status: 'completed',
          },
        ],
        tournaments: [
          { id: 'tournament-1', event_id: 'event-1', slug: 'longsword', name: 'Longsword' },
        ],
      },
      reports: { tournaments: [] },
    };

    const result = await service.restoreArchiveCopy(
      Buffer.from(JSON.stringify(archive)),
      'user-1',
      {
        targetOrganizationId: 'org-1',
        confirmation: 'RESTORE MYCLASH ARCHIVE',
      },
    );

    expect(result.scope).toBe('event');
    expect(inserted.events?.[0]?.id).not.toBe('event-1');
    expect(inserted.events?.[0]?.slug).toMatch(/^fal-restored-/);
    expect(inserted.tournaments?.[0]?.event_id).toBe(inserted.events?.[0]?.id);
  });
});
