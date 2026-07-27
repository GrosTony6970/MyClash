import { describe, expect, it } from 'vitest';
import { ExportsService } from './exports.service';

type Row = Record<string, unknown>;

interface TableData {
  events?: Row | null;
  tournaments?: Row[];
  matches?: Row[];
  match_forfeits?: Row[];
  persons?: Row[];
  clubs?: Row[];
}

/** Records every filter a query applied, so tests can pin the query shape. */
interface Recorded {
  table: string;
  select: string;
  filters: { op: string; column: string; value: unknown }[];
}

function makeService(data: TableData, error: { message: string } | null = null) {
  const recorded: Recorded[] = [];

  const supabase = {
    service: {
      from(table: string) {
        const entry: Recorded = { table, select: '', filters: [] };
        recorded.push(entry);

        const rows = (data[table as keyof TableData] ?? []) as Row[] | Row | null;
        const listResult = { data: Array.isArray(rows) ? rows : [], error };

        const chain: Record<string, unknown> = {
          select(columns: string) {
            entry.select = columns;
            return chain;
          },
          eq(column: string, value: unknown) {
            entry.filters.push({ op: 'eq', column, value });
            return chain;
          },
          in(column: string, value: unknown) {
            entry.filters.push({ op: 'in', column, value });
            return chain;
          },
          is(column: string, value: unknown) {
            entry.filters.push({ op: 'is', column, value });
            return chain;
          },
          order(column: string) {
            entry.filters.push({ op: 'order', column, value: null });
            return chain;
          },
          maybeSingle() {
            return Promise.resolve({ data: (Array.isArray(rows) ? rows[0] : rows) ?? null, error });
          },
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve(resolve(listResult));
          },
        };
        return chain;
      },
    },
  };

  return { service: new ExportsService(supabase as never), recorded };
}

// A completed pool match: Anna (p1) beat Carl (p2).
const MATCH_ROWS: Row[] = [
  {
    id: 'm1',
    end_reason: null,
    winner_registration_id: 'r1',
    match_number_label: 'P1M1',
    red_registration_id: 'r1',
    blue_registration_id: 'r2',
    pools: { sort_order: 0 },
    bracket_slots: null,
    phases: { tournament_id: 't1', type: 'pool', sort_order: 0, config_json: null },
    red_reg: { id: 'r1', person_id: 'p1' },
    blue_reg: { id: 'r2', person_id: 'p2' },
  },
];

const BASE: TableData = {
  events: { slug: 'lyon-open' },
  tournaments: [{ id: 't1', name: "Women's Steel Longsword", sort_order: 0 }],
  matches: MATCH_ROWS,
  match_forfeits: [],
  persons: [
    {
      id: 'p1',
      given_name: 'Anna',
      family_name: 'Berg',
      club_id: 'c1',
      hema_ratings_id: '10',
      gender_category: 'F',
      global_persons: { country_code: 'SE' },
    },
    {
      id: 'p2',
      given_name: 'Carl',
      family_name: 'Dahl',
      club_id: 'c1',
      hema_ratings_id: null,
      gender_category: 'M',
      global_persons: null,
    },
  ],
  clubs: [{ id: 'c1', name: 'Lyon HEMA', country_code: 'FR', city: 'Lyon', website: null }],
};

describe('ExportsService — HEMA Ratings submission', () => {
  it('reaches matches through phases.tournament_id, not a tournament_id column', async () => {
    // matches has NO tournament_id column. Filtering directly on it 400s and
    // silently exported an empty file for the whole life of the old endpoint —
    // this pins the join that actually works.
    const { service, recorded } = makeService(BASE);
    await service.previewHemaRatingsSubmission('event-1');

    const matchQuery = recorded.find((entry) => entry.table === 'matches');
    expect(matchQuery).toBeDefined();
    expect(matchQuery!.select).toContain('phases!inner');
    expect(matchQuery!.filters).toContainEqual({
      op: 'in',
      column: 'phases.tournament_id',
      value: ['t1'],
    });
    expect(matchQuery!.filters.some((f) => f.column === 'tournament_id')).toBe(false);
  });

  it('only counts un-voided forfeits', async () => {
    const { service, recorded } = makeService(BASE);
    await service.previewHemaRatingsSubmission('event-1');

    const forfeitQuery = recorded.find((entry) => entry.table === 'match_forfeits');
    expect(forfeitQuery!.filters).toContainEqual({ op: 'is', column: 'voided_at', value: null });
  });

  it('throws instead of exporting an empty file when a query fails', async () => {
    const { service } = makeService(BASE, { message: 'column does not exist' });
    await expect(service.previewHemaRatingsSubmission('event-1')).rejects.toThrow(
      /Export query .* failed/,
    );
  });

  it('names the zip after the event slug', async () => {
    const { service } = makeService(BASE);
    const { filename, buffer } = await service.generateHemaRatingsZip('event-1');
    expect(filename).toBe('lyon-open-hemaratings.zip');
    // "PK\x03\x04" — a real zip local file header.
    expect(buffer.subarray(0, 4).toString('binary')).toBe('PK');
  });

  it('reports the files, counts and warnings it would ship', async () => {
    const { service } = makeService(BASE);
    const preview = await service.previewHemaRatingsSubmission('event-1');

    expect(preview.files.sort()).toEqual([
      "Women's Steel Longsword.csv",
      'clubs.csv',
      'fighters.csv',
    ]);
    expect(preview.counts).toMatchObject({ fighters: 2, clubs: 1, matches: 1, tournaments: 1 });
    // Carl has no HEMA Ratings ID.
    expect(preview.warnings.find((w) => w.code === 'fighter_missing_hema_id')?.samples).toEqual([
      'Carl Dahl',
    ]);
  });

  it("prefers the fighter's own country over the club's", async () => {
    const { service } = makeService(BASE);
    await service.previewHemaRatingsSubmission('event-1');
    const { buffer } = await service.generateHemaRatingsZip('event-1');
    const text = buffer.toString('utf8');
    // Anna: global_persons.country_code SE wins over the club's FR.
    expect(text).toContain('Anna Berg,Lyon HEMA,SE,F,10');
    // Carl: no global person, so the club's FR is the fallback.
    expect(text).toContain('Carl Dahl,Lyon HEMA,FR,M,');
  });

  it('returns an empty bundle for an event with no tournaments', async () => {
    const { service } = makeService({ ...BASE, tournaments: [] });
    const preview = await service.previewHemaRatingsSubmission('event-1');
    expect(preview.counts.fighters).toBe(0);
    expect(preview.files).toEqual(['fighters.csv']);
  });
});
