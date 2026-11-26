import { ExportsService } from './exports.service';

export type Row = Record<string, unknown>;

export interface TableData {
  events?: Row | null;
  tournaments?: Row[];
  matches?: Row[];
  match_forfeits?: Row[];
  persons?: Row[];
  clubs?: Row[];
}

/** Records every filter a query applied, so tests can pin the query shape. */
export interface Recorded {
  table: string;
  select: string;
  filters: { op: string; column: string; value: unknown }[];
}

export function makeService(data: TableData, error: { message: string } | null = null) {
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
export const MATCH_ROWS: Row[] = [
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

export const BASE: TableData = {
  events: { slug: 'lyon-open' },
  tournaments: [
    { id: 't1', name: "Women's Steel Longsword", sort_order: 0, entrant_kind: 'individual' },
  ],
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
