import { describe, expect, it } from 'vitest';
import { danglingReferences, describeDangling } from './archive-references';
import type { ArchiveKey } from './archive.tables';

/**
 * Hand-built archives, each holding one reference. The generated archives that
 * must hold none are checked in archive.service.test.ts, where the fixtures
 * that produce them live.
 *
 * `data` is keyed by the envelope's own names, so a table spelt the database's
 * way (`referee_assignments` for `refereeAssignments`) fails the typecheck. A
 * key the check never reads would make every "finds nothing" case pass unread.
 */
const archive = (
  scope: 'event' | 'tournament',
  include: 'structure' | 'scoring',
  data: Partial<Record<ArchiveKey, Array<Record<string, unknown>>>>,
) => ({ scope, include, data: { events: [], tournaments: [], ...data } }) as never;

const PHASE = { phases: [{ id: 'ph-1' }] };

describe('danglingReferences', () => {
  it('finds a bout on a Lice the archive does not contain', () => {
    const found = danglingReferences(
      archive('tournament', 'scoring', {
        ...PHASE,
        lices: [{ id: 'lice-1' }],
        matches: [{ id: 'm-1', phase_id: 'ph-1', lice_id: 'lice-ghost' }],
      }),
    );

    expect(found).toEqual([{ table: 'matches', column: 'lice_id', id: 'lice-ghost' }]);
  });

  it("finds a table's own foreign key, a correction naming a missing exchange", () => {
    const found = danglingReferences(
      archive('event', 'scoring', {
        ...PHASE,
        matches: [{ id: 'm-1', phase_id: 'ph-1' }],
        exchanges: [{ id: 'ex-2', match_id: 'm-1', corrected_exchange_id: 'ex-ghost' }],
      }),
    );

    expect(found).toEqual([
      { table: 'exchanges', column: 'corrected_exchange_id', id: 'ex-ghost' },
    ]);
  });

  it("finds a bar naming a Tournament or Workshop that is not the archive's", () => {
    // The restore door the programme check cannot see: an edited Event archive
    // whose bar names another Event's Tournament would be written as it stands.
    const found = danglingReferences(
      archive('event', 'structure', {
        tournaments: [{ id: 't-1' }],
        workshops: [{ id: 'w-1' }],
        eventProgrammeBlocks: [
          { id: 'pb-1', competition_id: 't-elsewhere' },
          { id: 'pb-2', workshop_id: 'w-elsewhere' },
          { id: 'pb-3', competition_id: 't-1', workshop_id: 'w-1' },
        ],
      }),
    );

    expect(found).toEqual([
      { table: 'event_programme_blocks', column: 'competition_id', id: 't-elsewhere' },
      { table: 'event_programme_blocks', column: 'workshop_id', id: 'w-elsewhere' },
    ]);
  });

  it('finds a roster person a registration names and the archive does not contain', () => {
    const found = danglingReferences(
      archive('tournament', 'structure', {
        persons: [{ id: 'p-1' }],
        registrations: [
          { id: 'r-1', person_id: 'p-1' },
          { id: 'r-2', person_id: 'p-ghost' },
        ],
      }),
    );

    expect(found).toEqual([{ table: 'registrations', column: 'person_id', id: 'p-ghost' }]);
  });

  it('leaves a global person alone wherever person_id names one', () => {
    const found = danglingReferences(
      archive('event', 'scoring', {
        ...PHASE,
        persons: [{ id: 'p-1' }],
        matches: [{ id: 'm-1', phase_id: 'ph-1', referee_id: 'p-1' }],
        refereeAssignments: [{ id: 'ra-1', person_id: 'gp-1', match_id: 'm-1' }],
        eventReferees: [{ id: 'er-1', person_id: 'gp-1', global_person_id: 'gp-1' }],
      }),
    );

    expect(found).toEqual([]);
  });

  it("leaves a Match's referee alone, which this app can point at another Event", () => {
    // A Tournament restored into another Event keeps a non-fighting referee's
    // source id, and PATCH /matches takes any person: refusing it would refuse
    // an archive the app wrote.
    const refereeElsewhere = {
      ...PHASE,
      persons: [{ id: 'p-1' }],
      matches: [{ id: 'm-1', phase_id: 'ph-1', referee_id: 'p-other-event' }],
    };

    expect(danglingReferences(archive('event', 'scoring', refereeElsewhere))).toEqual([]);
    expect(danglingReferences(archive('tournament', 'scoring', refereeElsewhere))).toEqual([]);
  });

  it("finds a referee's Tournament or day with no referee row to hang from", () => {
    const found = danglingReferences(
      archive('event', 'structure', {
        eventReferees: [{ id: 'er-1', person_id: 'gp-1' }],
        eventRefereeTournaments: [{ person_id: 'gp-1', tournament_id: 't-1' }],
        eventRefereeDays: [{ person_id: 'gp-2', day_index: 0 }],
      }),
    );

    expect(found).toEqual([{ table: 'event_referee_days', column: 'person_id', id: 'gp-2' }]);
  });

  it('skips the Matches of a structure archive, which holds none', () => {
    const found = danglingReferences(
      archive('event', 'structure', {
        refereeAssignments: [{ id: 'ra-1', person_id: 'gp-1', match_id: 'm-1' }],
      }),
    );

    expect(found).toEqual([]);
  });

  it('skips the restore targets and ids inside JSON columns', () => {
    const found = danglingReferences(
      archive('event', 'scoring', {
        ...PHASE,
        matches: [{ id: 'm-1', phase_id: 'ph-1', tournament_id: 't-elsewhere' }],
        matchForfeits: [{ id: 'mf-1', match_id: 'm-1', downstream_match_ids: ['m-ghost'] }],
        eventProgrammeConfigs: [
          { event_id: 'e-elsewhere', config_json: { tournaments: [{ tournamentId: 't-gone' }] } },
        ],
      }),
    );

    expect(found).toEqual([]);
  });
});

describe('describeDangling', () => {
  it('names the first five references and counts the rest', () => {
    const refs = Array.from({ length: 7 }, (_, index) => ({
      table: 'matches' as const,
      column: 'lice_id',
      id: `lice-${index}`,
    }));

    const message = describeDangling(refs);

    expect(message).toContain('refers to 7 record(s) it does not contain');
    expect(message).toContain('matches.lice_id lice-4');
    expect(message).not.toContain('lice-5');
    expect(message).toContain('and 2 more');
  });
});
