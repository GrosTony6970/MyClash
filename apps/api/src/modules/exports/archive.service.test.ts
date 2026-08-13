import { ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ArchiveService } from './archive.service';
import { ARCHIVE_COLLECTED_TABLES, TABLE_TO_ARCHIVE_KEY } from './archive.tables';

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
    // Both carry an org-level venue reference that a cross-org copy cannot
    // resolve. `lices.area_id` (0169) and `workshops.venue_id` (0090) were
    // absent from this fixture, which is why nothing noticed neither was being
    // cleared.
    lices: [
      {
        id: 'lice-1',
        event_id: 'event-1',
        name: 'Piste 1',
        venue_id: 'venue-1',
        area_id: 'area-1',
      },
    ],
    workshops: [{ id: 'w-1', event_id: 'event-1', title: 'Drills', venue_id: 'venue-1' }],
    persons: [
      { id: 'p-1', event_id: 'event-1', given_name: 'A', family_name: 'B', email: 'a@b.c' },
    ],
    registrations: [{ id: 'r-1', tournament_id: 't-1', person_id: 'p-1' }],
    phases: [
      {
        id: 'ph-1',
        tournament_id: 't-1',
        type: 'pool',
        // A bracket_slots.id inside a JSON column, pointing FORWARD in
        // INSERT_ORDER (bracket_slots is inserted after phases).
        config_json: { bronzeSlotId: 'bs-1', bracketSize: 8 },
      },
    ],
    bracket_slots: [{ id: 'bs-1', phase_id: 'ph-1', round: 1, position: 1 }],
    swiss_rounds: [
      {
        id: 'sr-1',
        phase_id: 'ph-1',
        round_number: 1,
        pairing_meta_json: {
          ranked: ['r-1'],
          warnings: [{ code: 'same-club', registrationIds: ['r-1'] }],
          manualAdjustments: [
            { kind: 'swap', aRegistrationId: 'r-1', bRegistrationId: 'r-1', warnings: [] },
            {
              kind: 'set-sides',
              matchId: 'm-1',
              from: { red: 'r-1', blue: null },
              to: { red: 'r-1', blue: null },
              warnings: [{ code: 'creates-rematch', registrationIds: ['r-1'] }],
              // An auth user, not an event-scoped row — must pass through.
              byUserId: 'user-9',
            },
          ],
          generatedAt: '2026-01-01T00:00:00Z',
        },
      },
    ],
    exchanges: [
      { id: 'ex-1', match_id: 'm-1', client_uuid: 'cu-ex-1', sequence: 1 },
      // A correction pointing at the exchange it replaced (0019).
      {
        id: 'ex-2',
        match_id: 'm-1',
        client_uuid: 'cu-ex-2',
        sequence: 2,
        corrected_exchange_id: 'ex-1',
      },
    ],
    matches: [
      {
        id: 'm-1',
        phase_id: 'ph-1',
        tournament_id: 't-1',
        status: 'completed',
        red_registration_id: 'r-1',
        // An event-scoped persons.id (migration 0039), so it must be remapped.
        referee_id: 'p-1',
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
        // Three ids the column sweep cannot see: one in an array, two nested.
        downstream_match_ids: ['m-1'],
        previous_match_state: { status: 'running', winner_registration_id: 'r-1' },
        previous_registration_state: { id: 'r-1', status: 'checked_in' },
      },
    ],
    tournament_penalty_reviews: [
      {
        id: 'tpr-1',
        tournament_id: 't-1',
        registration_id: 'r-1',
        review_type: 'second_black_card',
        status: 'pending',
        black_card_count: 2,
        // match_penalties.id values, in an array inside a JSON column.
        payload_json: { penaltyIds: ['mp-1'] },
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

  /**
   * `matches.referee_id` was the one person reference `remapRow` did not remap,
   * so a restored match kept pointing at the SOURCE event's person. A restore is
   * supposed to produce a self-contained copy: nothing in it may reference a row
   * belonging to the archive's source.
   */
  it("re-points a match referee at the restored person, not the source event's", async () => {
    const { service, inserted } = makeService(scopedRows());
    const archive = await service.generateEventArchive('event-1', 'user-1', { include: 'scoring' });
    expect(archive.data.matches?.[0]?.['referee_id'], 'the archive must carry it').toBe('p-1');

    await service.restoreArchiveCopy(Buffer.from(JSON.stringify(archive)), 'user-1', {
      targetOrganizationId: 'org-1',
      confirmation: 'RESTORE MYCLASH ARCHIVE',
    });

    const restoredPersonId = inserted.persons?.[0]?.id as string;
    expect(restoredPersonId, 'the person is copied under a new id').not.toBe('p-1');
    expect(inserted.matches?.[0]?.referee_id).toBe(restoredPersonId);
  });

  /**
   * A restore must produce a SELF-CONTAINED copy. `mapFk` returns early on
   * anything that is not a top-level string, so every id nested in an array or
   * an object survived verbatim and kept pointing into the source event — with
   * the FK satisfied, because the source rows still exist, so nothing ever
   * complained. Same shape as the `bye_registration_id` and `referee_id` misses
   * above, one level down.
   *
   * One test per leak class. `restoreScoped()` runs the round trip once.
   */
  describe('ids nested inside JSON columns', () => {
    async function restoreScoped() {
      const { service, inserted } = makeService(scopedRows());
      const archive = await service.generateEventArchive('event-1', 'user-1', {
        include: 'scoring',
      });
      await service.restoreArchiveCopy(Buffer.from(JSON.stringify(archive)), 'user-1', {
        targetOrganizationId: 'org-1',
        confirmation: 'RESTORE MYCLASH ARCHIVE',
      });
      return {
        inserted,
        matchId: inserted.matches?.[0]?.id as string,
        registrationId: inserted.registrations?.[0]?.id as string,
        slotId: inserted.bracket_slots?.[0]?.id as string,
        forfeit: inserted.match_forfeits?.[0] as Record<string, unknown>,
        swissRound: inserted.swiss_rounds?.[0] as Record<string, unknown>,
      };
    }

    it('remaps an ARRAY of ids (match_forfeits.downstream_match_ids)', async () => {
      const { forfeit, matchId } = await restoreScoped();
      expect(matchId, 'the match is copied under a new id').not.toBe('m-1');
      expect(forfeit['downstream_match_ids']).toEqual([matchId]);
    });

    it('remaps ids nested in an OBJECT (match_forfeits.previous_*_state)', async () => {
      const { forfeit, registrationId } = await restoreScoped();
      expect(registrationId).not.toBe('r-1');
      expect(forfeit['previous_match_state']).toMatchObject({
        status: 'running',
        winner_registration_id: registrationId,
      });
      expect(forfeit['previous_registration_state']).toMatchObject({
        id: registrationId,
        status: 'checked_in',
      });
    });

    it('remaps a FORWARD reference — phases.config_json.bronzeSlotId', async () => {
      // bracket_slots is inserted AFTER phases, so this only resolves because
      // the id-map pre-seed runs as its own pass over the whole INSERT_ORDER.
      const { inserted, slotId } = await restoreScoped();
      expect(slotId, 'the slot is copied under a new id').not.toBe('bs-1');
      expect(inserted.phases?.[0]?.config_json).toMatchObject({
        bronzeSlotId: slotId,
        bracketSize: 8,
      });
    });

    it('remaps every id shape in swiss_rounds.pairing_meta_json', async () => {
      const { swissRound, registrationId, matchId } = await restoreScoped();
      const meta = swissRound['pairing_meta_json'] as Record<string, unknown>;

      expect(meta['ranked']).toEqual([registrationId]);
      expect(meta['warnings']).toEqual([{ code: 'same-club', registrationIds: [registrationId] }]);

      const adjustments = meta['manualAdjustments'] as Array<Record<string, unknown>>;
      // A `swap` entry names two registrations directly...
      expect(adjustments[0]).toMatchObject({
        aRegistrationId: registrationId,
        bRegistrationId: registrationId,
      });
      // ...a `set-sides` entry names a match and both side pairs.
      expect(adjustments[1]).toMatchObject({
        matchId,
        from: { red: registrationId, blue: null },
        to: { red: registrationId, blue: null },
        // An auth user is not an event-scoped row: it passes through.
        byUserId: 'user-9',
      });
      expect(adjustments[1]?.['warnings']).toEqual([
        { code: 'creates-rematch', registrationIds: [registrationId] },
      ]);
    });

    it('remaps the self-referencing exchanges.corrected_exchange_id', async () => {
      // Not nested at all — a plain column the sweep simply never listed.
      const { inserted } = await restoreScoped();
      const restored = inserted.exchanges as Array<Record<string, unknown>>;
      const original = restored.find((row) => row['sequence'] === 1);
      const correction = restored.find((row) => row['sequence'] === 2);
      expect(original?.['id']).not.toBe('ex-1');
      expect(correction?.['corrected_exchange_id']).toBe(original?.['id']);
    });

    it('remaps the penalty ids a second-black-card review names', async () => {
      // Found by the schema-scan gate, not by review: `payload_json` holds the
      // `match_penalties.id`s that triggered the review, and a restored copy
      // named the SOURCE event's penalties. The FK is not declared, so nothing
      // could ever have complained — confirming or dismissing the copy's review
      // would have read another event's cards.
      const { inserted } = await restoreScoped();
      const penaltyId = inserted.match_penalties?.[0]?.id as string;
      expect(penaltyId, 'the penalty is copied under a new id').not.toBe('mp-1');
      expect(inserted.tournament_penalty_reviews?.[0]?.payload_json).toEqual({
        penaltyIds: [penaltyId],
      });
    });

    it('leaves an id with no counterpart in the archive alone', async () => {
      // Matches `mapFk`: a reference to something outside the archive survives
      // rather than becoming undefined. Passes pre-fix — a no-regression guard.
      const { swissRound } = await restoreScoped();
      const meta = swissRound['pairing_meta_json'] as Record<string, unknown>;
      expect(meta['generatedAt']).toBe('2026-01-01T00:00:00Z');
    });
  });

  /**
   * Anti-vacuity: a table the fixture has rows for must arrive in the archive.
   *
   * Without this, declaring a real table uncollected passes almost everything
   * here — the assertions that read it do `restored.find(...)?.['id']`, and an
   * empty array satisfies an `undefined` comparison just as well as a correct
   * one. Two of the tests below were vacuously green when `exchanges` was
   * collected as `[]`.
   *
   * Bounded by the fixture, deliberately: it can only speak for the tables
   * `scopedRows()` provides, which is why the registry's own suite asserts the
   * shape of the rules rather than their effect.
   */
  it('carries every fixture table the registry says an event archive collects', async () => {
    const rows = scopedRows();
    const { service } = makeService(rows);

    const archive = await service.generateEventArchive('event-1', 'user-1', {
      include: 'scoring',
    });

    // No exception for an `omit` rule: an EVENT archive is the whole event, so
    // every declared table is collected at that scope. Excusing `omit` here
    // would make this blind to the one mistake it exists to catch — which it
    // was, until declaring `exchanges` uncollected sailed straight past it.
    const empty = Object.keys(rows)
      .filter((table) => ARCHIVE_COLLECTED_TABLES.has(table))
      .filter((table) => {
        const key = TABLE_TO_ARCHIVE_KEY[table as never] as string;
        return ((archive.data as Record<string, unknown[]>)[key] ?? []).length === 0;
      })
      .sort();

    expect(
      empty,
      'the fixture has rows for these tables and the archive came back empty for them — ' +
        'their collect rule is wrong, and every assertion that reads them is now vacuous',
    ).toEqual([]);
  });

  /**
   * Sentinel sweep: after a restore, no value ANYWHERE in an inserted row may
   * equal an id belonging to the source event.
   *
   * The declarative gate in `archive.migration-coverage.test.ts` answers "did
   * anyone forget a COLUMN?" — it reads the schema, so it sees every column
   * that exists and none of what is inside one. This answers the question the
   * schema cannot: "did anyone add a KEY inside a JSON column that is already
   * declared?" It walks to any depth and needs nothing declared.
   *
   * Its limit is the mirror image, and worth stating rather than implying: it
   * only sees shapes `scopedRows()` contains. A JSON key the fixture never
   * carries is invisible here too. Neither test is a guarantee on its own.
   */
  it('leaves no source id anywhere in a restored copy', async () => {
    const rows = scopedRows();
    const sourceIds = new Set<string>();
    for (const table of Object.values(rows) as Array<Record<string, unknown>[]>) {
      for (const row of table) {
        if (typeof row['id'] === 'string') sourceIds.add(row['id']);
      }
    }
    // References to rows OUTSIDE the archive are not source ids by construction
    // — a global person, an org-level venue or plan, an auth user is never the
    // `id` of an archived row. They are asserted positively at the end rather
    // than subtracted here, so an over-eager "remap everything" is caught too.

    const { service, inserted } = makeService(rows);
    const archive = await service.generateEventArchive('event-1', 'user-1', {
      include: 'scoring',
    });
    await service.restoreArchiveCopy(Buffer.from(JSON.stringify(archive)), 'user-1', {
      targetOrganizationId: 'org-1',
      confirmation: 'RESTORE MYCLASH ARCHIVE',
    });

    const survivors: string[] = [];
    const walk = (node: unknown, trail: string): void => {
      if (typeof node === 'string') {
        if (sourceIds.has(node)) survivors.push(`${trail} = ${node}`);
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((element, index) => walk(element, `${trail}[${index}]`));
        return;
      }
      if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) walk(value, `${trail}.${key}`);
      }
    };
    for (const [table, insertedRows] of Object.entries(inserted)) {
      // Archived tables only. The restore also writes an `audit_log` entry
      // whose payload names the source event ON PURPOSE — that row is the
      // record of where the copy came from, not part of the copy.
      if (!ARCHIVE_COLLECTED_TABLES.has(table)) continue;
      insertedRows.forEach((row, index) => walk(row, `${table}[${index}]`));
    }

    expect(
      survivors.sort(),
      `A restore must produce a SELF-CONTAINED copy. These values still name a ` +
        `row belonging to the archive's SOURCE event — nothing will complain, ` +
        `because those rows still exist, and the copy will quietly read another ` +
        `event's data:\n` +
        survivors.map((entry) => `  - ${entry}`).join('\n'),
    ).toEqual([]);

    // …and the sweep must not be so eager that a legitimate outside reference
    // gets rewritten into nothing.
    expect(inserted.event_referees?.[0]?.person_id, 'a global person passes through').toBe('gp-1');
    expect(inserted.event_venues?.[0]?.venue_id, 'an org-level venue passes through').toBe(
      'venue-1',
    );
  });

  /**
   * A tournament restore inserted its tournament under a THIRD id.
   *
   * `restoreTournamentCopy` mints `restoredTournamentId`, points the id map at
   * it and rewrites the row to carry it — but `insertMappedTables` pre-seeds
   * every table's id map with a fresh UUID for any row id it has not seen, and
   * it had only seen the SOURCE id as a key. So the row was remapped again while
   * the children still pointed at `restoredTournamentId`, and every child insert
   * violated its foreign key. `restoreEventCopy` self-maps its new id for
   * exactly this reason; this path did not.
   *
   * Asserted as id consistency rather than as an error, because the mock does
   * not enforce foreign keys — which is precisely why this survived.
   */
  it('inserts the restored tournament under the id its children were given', async () => {
    const { service, inserted } = makeService(scopedRows());
    const archive = await service.generateTournamentArchive('t-1', 'user-1', {
      include: 'scoring',
    });

    const result = await service.restoreArchiveCopy(
      Buffer.from(JSON.stringify(archive)),
      'user-1',
      { targetEventId: 'event-1', confirmation: 'RESTORE MYCLASH ARCHIVE' },
    );

    const insertedTournamentId = inserted.tournaments?.[0]?.id;
    expect(insertedTournamentId, 'the row must carry the id the caller was handed').toBe(
      result.restoredTournamentId,
    );
    expect(
      inserted.registrations?.[0]?.tournament_id,
      'every child must point at the tournament that was actually inserted',
    ).toBe(insertedTournamentId);
    expect(inserted.phases?.[0]?.tournament_id).toBe(insertedTournamentId);
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
    // Both found by making the column gate per-table. A venue_area belongs to a
    // venue owned by the source org, so lices.area_id leaks exactly as its
    // venue_id sibling does; workshops.venue_id is the default its sessions
    // pre-fill from, and the sessions cleared theirs while the parent did not.
    expect(inserted.lices?.[0]?.venue_id).toBeNull();
    expect(inserted.lices?.[0]?.area_id).toBeNull();
    expect(inserted.workshops?.[0]?.venue_id).toBeNull();
  });

  it('keeps org-level venue references when the copy stays in the same org', async () => {
    // The other half of the pair: nulling these unconditionally would strip a
    // same-org copy of venues that resolve perfectly well.
    const { service, inserted } = makeService(scopedRows());
    const archive = await service.generateEventArchive('event-1', 'user-1', { include: 'scoring' });

    await service.restoreArchiveCopy(Buffer.from(JSON.stringify(archive)), 'user-1', {
      targetOrganizationId: 'org-1',
      confirmation: 'RESTORE MYCLASH ARCHIVE',
    });

    expect(inserted.lices?.[0]?.venue_id).toBe('venue-1');
    expect(inserted.lices?.[0]?.area_id).toBe('area-1');
    expect(inserted.workshops?.[0]?.venue_id).toBe('venue-1');
    expect(inserted.event_venues?.[0]?.venue_id).toBe('venue-1');
  });
});
