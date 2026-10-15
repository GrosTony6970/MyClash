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

        const filter = (op: string) => (column: string, value: unknown) => {
          entry.filters.push({ op, column, value });
          return chain;
        };
        const chain: Record<string, unknown> = {
          select(columns: string) {
            entry.select = columns;
            return chain;
          },
          eq: filter('eq'),
          in: filter('in'),
          is: filter('is'),
          // A paged read: the page after the last row is empty, so the read ends.
          gt: filter('gt'),
          order: (column: string) => filter('order')(column, null),
          limit: (count: number) => filter('limit')('', count),
          maybeSingle() {
            return Promise.resolve({ data: (Array.isArray(rows) ? rows[0] : rows) ?? null, error });
          },
          then(resolve: (value: unknown) => unknown) {
            const pastTheEnd = entry.filters.some((f) => f.op === 'gt');
            return Promise.resolve(resolve(pastTheEnd ? { data: [], error } : listResult));
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

/** A hit of `match` (one bout of Tournament "Longsword", Pool 1). */
function hit(id: string, sequence: number, occurredAt = '2026-03-14T09:00:00+00:00'): Row {
  return {
    id,
    type: 'clean',
    sequence,
    occurred_at: occurredAt,
    first_striker_color: 'red',
    first_strike_value: 1,
    afterblow_value: null,
    no_exchange_reason: null,
    clock_time_ms: 1000,
    voided: false,
    voided_reason: null,
    matches: {
      match_number_label: 'M1',
      pools: { sort_order: 0 },
      bracket_slots: null,
      swiss_rounds: null,
      phases: { config_json: null, tournaments: { name: 'Longsword', weapon: null } },
    },
  };
}

/**
 * The exchanges read of the full CSV, answered page by page: each read takes the next page, and a
 * read past the last page is answered empty.
 */
function pagedExchanges(pages: Row[][], error: { message: string } | null = null) {
  const reads: { select: string; filters: string[] }[] = [];
  const supabase = {
    service: {
      from() {
        const read = { select: '', filters: [] as string[] };
        reads.push(read);
        const chain: Record<string, unknown> = {
          select(columns: string) {
            read.select = columns.replace(/\s+/g, ' ');
            return chain;
          },
          eq(column: string, value: unknown) {
            read.filters.push(`eq ${column} ${String(value)}`);
            return chain;
          },
          order(column: string) {
            read.filters.push(`order ${column}`);
            return chain;
          },
          gt(column: string, value: unknown) {
            read.filters.push(`gt ${column} ${String(value)}`);
            return chain;
          },
          limit(count: number) {
            read.filters.push(`limit ${count}`);
            return chain;
          },
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve(resolve({ data: pages[reads.length - 1] ?? [], error }));
          },
        };
        return chain;
      },
    },
  };
  return { service: new ExportsService(supabase as never), reads };
}

describe('ExportsService — the full event CSV', () => {
  it("reaches the Event through inner joins, so another Event's hit is not in the file", async () => {
    // Without `!inner` the nested Event filter only blanked the Tournament: every hit of every
    // Event came back, other clubs' void reasons included.
    const { service, reads } = pagedExchanges([[hit('x1', 1)]]);
    await service.generateFullCsvRows('event-1');
    expect(reads[0]!.select).toContain('matches!inner (');
    expect(reads[0]!.select).toContain('phases!inner (');
    expect(reads[0]!.select).toContain('tournaments!inner (');
    expect(reads[0]!.filters).toContain('eq matches.phases.tournaments.event_id event-1');
  });

  it('reads past the 1000 rows one read returns, each page after the last id', async () => {
    const first = Array.from({ length: 1000 }, (_, n) =>
      hit(`a${String(n).padStart(4, '0')}`, n + 1),
    );
    const { service, reads } = pagedExchanges([first, [hit('b0', 1001)]]);
    const rows = await service.generateFullCsvRows('event-1');
    // By key, not by offset: a hit a pad sends between two pages cannot shift a row onto both.
    expect(reads.map((read) => read.filters.filter((f) => !f.startsWith('eq ')))).toEqual([
      ['order id', 'limit 1000'],
      ['order id', 'limit 1000', 'gt id a0999'],
      ['order id', 'limit 1000', 'gt id b0'],
    ]);
    expect(rows).toHaveLength(1 + 1001);
    expect(rows[1]).toEqual([
      'Longsword',
      expect.any(String),
      'M1',
      1,
      'clean',
      'red',
      1,
      null,
      null,
      1000,
      'false',
      null,
    ]);
  });

  it('writes the hits in the order they were struck, whatever order the reads gave', async () => {
    const { service } = pagedExchanges([
      [hit('a', 2, '2026-03-14T09:05:00+00:00'), hit('b', 1, '2026-03-14T09:01:00+00:00')],
      [hit('c', 3, '2026-03-14T09:01:00+00:00')],
    ]);
    const rows = await service.generateFullCsvRows('event-1');
    expect(rows.slice(1).map((row) => row[3])).toEqual([1, 3, 2]);
  });

  it('fails the download when the read fails, instead of sending an empty file', async () => {
    const { service } = pagedExchanges([], { message: 'column does not exist' });
    await expect(service.generateFullCsvRows('event-1')).rejects.toThrow(/Export query .* failed/);
  });
});

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

  // One read stops at 1000 rows with no word: a big Event sent HEMA Ratings a short submission.
  it('reads the bouts and the forfeits page by page, each page after the last id', async () => {
    const { service, recorded } = makeService(BASE);
    await service.previewHemaRatingsSubmission('event-1');

    const paging = (table: string) =>
      recorded
        .filter((entry) => entry.table === table)
        .map((entry) => entry.filters.filter((f) => ['order', 'limit', 'gt'].includes(f.op)));
    expect(paging('matches')).toEqual([
      [
        { op: 'order', column: 'id', value: null },
        { op: 'limit', column: '', value: 1000 },
      ],
      [
        { op: 'order', column: 'id', value: null },
        { op: 'limit', column: '', value: 1000 },
        { op: 'gt', column: 'id', value: 'm1' },
      ],
    ]);
    expect(paging('match_forfeits')).toHaveLength(1);
    expect(recorded.find((entry) => entry.table === 'match_forfeits')!.select).toBe('id, match_id');
  });

  it('reads the fighters by pieces of 200 ids, so the request line holds', async () => {
    const bouts = Array.from({ length: 101 }, (_, n) => ({
      ...MATCH_ROWS[0],
      id: `m${String(n).padStart(3, '0')}`,
      red_reg: { id: `r${2 * n}`, person_id: `p${2 * n}` },
      blue_reg: { id: `r${2 * n + 1}`, person_id: `p${2 * n + 1}` },
    }));
    const { service, recorded } = makeService({ ...BASE, matches: bouts });
    await service.previewHemaRatingsSubmission('event-1');

    const pieces = recorded
      .filter((entry) => entry.table === 'persons')
      .map((entry) => (entry.filters.find((f) => f.op === 'in')!.value as string[]).length);
    expect(pieces).toEqual([200, 2]);
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
    expect(buffer.subarray(0, 4).toString('binary')).toBe('PK\x03\x04');
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

  /**
   * HEMA Ratings is an external, public rating database. Before migration 0162
   * this module had NO event-kind filter at all, so a dry run could be
   * submitted to it. Only standard events are rated.
   */
  describe('event-kind gate', () => {
    const withKind = (kind: string) =>
      makeService({ ...BASE, events: { slug: 'lyon-open', event_kind: kind } });

    for (const kind of ['test', 'club'] as const) {
      it(`refuses a ${kind} event from the preview endpoint`, async () => {
        const { service } = withKind(kind);
        await expect(service.previewHemaRatingsSubmission('event-1')).rejects.toThrow(
          /HEMA Ratings/i,
        );
      });

      it(`refuses a ${kind} event from the zip endpoint`, async () => {
        // One guard, two entry points — buildHemaRatingsSubmission is the
        // shared choke point, so neither route can be reached around it.
        const { service } = withKind(kind);
        await expect(service.generateHemaRatingsZip('event-1')).rejects.toThrow(/HEMA Ratings/i);
      });
    }

    it('allows a standard event', async () => {
      const { service } = withKind('standard');
      const preview = await service.previewHemaRatingsSubmission('event-1');
      expect(preview.counts.fighters).toBe(2);
    });

    it('treats a missing kind as standard, so legacy rows keep exporting', async () => {
      const { service } = makeService(BASE); // BASE.events has no event_kind
      const preview = await service.previewHemaRatingsSubmission('event-1');
      expect(preview.counts.fighters).toBe(2);
    });
  });
});
