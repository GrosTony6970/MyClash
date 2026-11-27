import { describe, expect, it } from 'vitest';
import { BASE, makeService } from './exports.service.fixtures';

describe('ExportsService — HEMA Ratings submission', () => {
  describe('team Tournaments', () => {
    const TEAM = { id: 't2', name: 'Team Steel Longsword', sort_order: 1, entrant_kind: 'team' };

    it('reads the kind of each Tournament', async () => {
      const { service, recorded } = makeService(BASE);
      await service.previewHemaRatingsSubmission('event-1');
      expect(recorded.filter((e) => e.table === 'tournaments').map((e) => e.select)).toEqual([
        'id, name, sort_order, entrant_kind',
      ]);
    });

    it('exports the individual Tournaments only, and warns once naming the team one', async () => {
      const { service, recorded } = makeService({
        ...BASE,
        tournaments: [...BASE.tournaments!, TEAM],
      });
      const preview = await service.previewHemaRatingsSubmission('event-1');

      // The bouts are read for the individual Tournament alone: a team's are never read.
      const inList = recorded
        .filter((e) => e.table === 'matches' || e.table === 'match_forfeits')
        .flatMap((e) =>
          e.filters.filter((f) => f.op === 'in' && f.column.endsWith('tournament_id')),
        );
      expect(inList.length).toBeGreaterThan(0);
      for (const f of inList) expect(f.value).toEqual(['t1']);
      expect(preview.files.sort()).toEqual([
        "Women's Steel Longsword.csv",
        'clubs.csv',
        'fighters.csv',
      ]);
      expect(preview.warnings.filter((w) => w.code === 'tournament_team_skipped')).toEqual([
        { code: 'tournament_team_skipped', count: 1, samples: ['Team Steel Longsword'] },
      ]);
    });

    it('gives the empty file and the warning for an Event of team Tournaments only', async () => {
      const { service, recorded } = makeService({ ...BASE, tournaments: [TEAM] });
      const preview = await service.previewHemaRatingsSubmission('event-1');

      expect(recorded.some((e) => e.table === 'matches')).toBe(false);
      expect(preview.files).toEqual(['fighters.csv']);
      expect(preview.warnings).toEqual([
        { code: 'tournament_team_skipped', count: 1, samples: ['Team Steel Longsword'] },
      ]);
    });

    it('refuses a Tournament whose kind was not read, instead of exporting it', async () => {
      const { service } = makeService({
        ...BASE,
        tournaments: [{ id: 't1', name: 'X', sort_order: 0 }],
      });
      await expect(service.previewHemaRatingsSubmission('event-1')).rejects.toThrow(
        /kind was not read/,
      );
    });
  });
});
