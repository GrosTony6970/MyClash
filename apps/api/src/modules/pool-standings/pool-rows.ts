/**
 * The PostgREST projection the pools select returns.
 *
 * This is a database row shape — `pool_members`, `registration_id`, and the
 * embedded `persons` / `clubs` rows are column and relationship names, not
 * domain vocabulary. It sat in `standings-rows.ts` beside `applyRanking`; when
 * the ranking moved into `@myclash/rules` this stayed, because a row shape
 * crossing into the deterministic core is exactly what the seam exists to stop.
 */
export interface PoolWithMembers {
  id: string;
  name: string;
  pool_members: Array<{
    registration_id: string;
    registrations: {
      id: string;
      persons: {
        id: string;
        given_name: string;
        family_name: string;
        clubs: { id: string; name: string; abbreviation: string | null } | null;
      };
    };
  }>;
}
