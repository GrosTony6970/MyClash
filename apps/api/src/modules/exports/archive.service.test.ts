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

  const scopedRows = () => ({
    events: [
      { id: 'event-1', organization_id: 'org-1', slug: 'fal', name: 'FAL', status: 'completed' },
    ],
    tournaments: [{ id: 't-1', event_id: 'event-1', slug: 'ls', name: 'LS' }],
    persons: [
      { id: 'p-1', event_id: 'event-1', given_name: 'A', family_name: 'B', email: 'a@b.c' },
    ],
    registrations: [{ id: 'r-1', tournament_id: 't-1', person_id: 'p-1' }],
    phases: [{ id: 'ph-1', tournament_id: 't-1', type: 'pool' }],
    matches: [
      {
        id: 'm-1',
        phase_id: 'ph-1',
        tournament_id: 't-1',
        status: 'completed',
        red_registration_id: 'r-1',
      },
    ],
    referee_skills: [{ id: 'skill-custom', event_id: 'event-1', name: 'Custom', is_system: false }],
    event_referees: [{ id: 'er-1', event_id: 'event-1', person_id: 'gp-1' }],
    event_referee_tournaments: [{ event_id: 'event-1', person_id: 'gp-1', tournament_id: 't-1' }],
    event_hidden_skills: [{ event_id: 'event-1', skill_id: 'skill-custom' }],
    referee_assignments: [
      { id: 'ra-1', event_id: 'event-1', person_id: 'gp-1', match_id: 'm-1', role: 'skill-custom' },
    ],
    event_programme_blocks: [
      {
        id: 'pb-1',
        event_id: 'event-1',
        competition_id: 't-1',
        block_type: 'competition',
        label: 'Pools',
        start_time: '09:00',
        end_time: '10:00',
      },
    ],
    workshop_breaks: [
      { id: 'wb-1', event_id: 'event-1', day_index: 0, start_time: '12:00', end_time: '13:00' },
    ],
    event_venues: [{ id: 'ev-1', event_id: 'event-1', venue_id: 'venue-1' }],
    tournament_phase_venues: [
      { id: 'tpv-1', tournament_id: 't-1', phase_kind: 'pool', venue_id: 'venue-1' },
    ],
    event_instructors: [{ event_id: 'event-1', person_id: 'gp-2' }],
    match_penalties: [
      {
        id: 'mp-1',
        client_uuid: 'cu-1',
        match_id: 'm-1',
        tournament_id: 't-1',
        registration_id: 'r-1',
        ruleset_id: 'rs-1',
        ruleset_entry_id: 're-1',
        sequence: 1,
        card: 'yellow',
        occurred_at: '2026-01-01T00:00:00Z',
      },
    ],
    match_forfeits: [
      {
        id: 'mf-1',
        match_id: 'm-1',
        tournament_id: 't-1',
        forfeiting_registration_id: 'r-1',
        winner_registration_id: 'r-1',
        reason: 'injury',
        score_policy: 'keep_current',
      },
    ],
    referee_compensation_event_settings: [{ event_id: 'event-1', plan_id: 'plan-1' }],
  });

  it('captures the newly-wired scoped tables in an event archive', async () => {
    const { service } = makeService(scopedRows());
    const archive = await service.generateEventArchive('event-1', 'user-1', { include: 'scoring' });

    expect(archive.data.refereeSkills).toHaveLength(1);
    expect(archive.data.eventReferees).toHaveLength(1);
    expect(archive.data.eventRefereeTournaments).toHaveLength(1);
    expect(archive.data.eventHiddenSkills).toHaveLength(1);
    expect(archive.data.eventInstructors).toHaveLength(1);
    expect(archive.data.eventProgrammeBlocks).toHaveLength(1);
    expect(archive.data.workshopBreaks).toHaveLength(1);
    expect(archive.data.eventVenues).toHaveLength(1);
    expect(archive.data.tournamentPhaseVenues).toHaveLength(1);
    expect(archive.data.matchPenalties).toHaveLength(1);
    expect(archive.data.matchForfeits).toHaveLength(1);
    expect(archive.data.refereeCompensationEventSettings).toHaveLength(1);
  });

  it('restores scoped tables into a same-org copy with remapped ids', async () => {
    const { service, inserted } = makeService({
      ...scopedRows(),
      // second event row so the restore target lookup / slug check has data
    });
    const archive = await service.generateEventArchive('event-1', 'user-1', { include: 'scoring' });

    await service.restoreArchiveCopy(Buffer.from(JSON.stringify(archive)), 'user-1', {
      targetOrganizationId: 'org-1',
      confirmation: 'RESTORE MYCLASH ARCHIVE',
    });

    const newEventId = inserted.events?.[0]?.id as string;
    expect(newEventId).not.toBe('event-1');

    // scoped children carried and re-parented to the new event/tournament
    expect(inserted.event_programme_blocks?.[0]?.event_id).toBe(newEventId);
    expect(inserted.workshop_breaks?.[0]?.event_id).toBe(newEventId);
    expect(inserted.event_referees?.[0]?.event_id).toBe(newEventId);
    // global-person references pass through unchanged (not copied)
    expect(inserted.event_referees?.[0]?.person_id).toBe('gp-1');

    // client_uuid is regenerated to keep the offline idempotency key unique
    expect(inserted.match_penalties?.[0]?.client_uuid).not.toBe('cu-1');
    // same-org: org-level references (ruleset, venue) are preserved
    expect(inserted.match_penalties?.[0]?.ruleset_id).toBe('rs-1');
    expect(inserted.event_venues?.[0]?.venue_id).toBe('venue-1');
    expect(inserted.referee_compensation_event_settings?.[0]?.plan_id).toBe('plan-1');

    // custom referee skill id is regenerated, and every reference to it follows
    const newSkillId = inserted.referee_skills?.[0]?.id as string;
    expect(newSkillId).not.toBe('skill-custom');
    expect(inserted.referee_assignments?.[0]?.role).toBe(newSkillId);
    expect(inserted.event_hidden_skills?.[0]?.skill_id).toBe(newSkillId);
  });

  it('drops org-level references when restoring into a different org', async () => {
    const { service, inserted } = makeService(scopedRows());
    const archive = await service.generateEventArchive('event-1', 'user-1', { include: 'scoring' });

    await service.restoreArchiveCopy(Buffer.from(JSON.stringify(archive)), 'user-1', {
      targetOrganizationId: 'org-2',
      confirmation: 'RESTORE MYCLASH ARCHIVE',
    });

    // event_venues + compensation settings reference the source org's rows → dropped
    expect(inserted.event_venues).toBeUndefined();
    expect(inserted.referee_compensation_event_settings).toBeUndefined();
    // nullable org-level FKs are cleared rather than dropped
    expect(inserted.tournament_phase_venues?.[0]?.venue_id).toBeNull();
    expect(inserted.match_penalties?.[0]?.ruleset_id).toBeNull();
    expect(inserted.match_penalties?.[0]?.ruleset_entry_id).toBeNull();
  });
});
