/**
 * The seeded rows each check of `db-rls-probe.mjs` names: what anon must see and must not, the
 * private columns, the tables only the API writes, and the organisation admin who tries the writes.
 * Every key is in packages/db/fixtures/rls-probe-seed.sql.
 */
/** Per table, the seeded keys anon must see and the ones it must not. Keys are in the seed file. */
export const VERDICTS = [
  {
    table: 'events',
    key: 'id',
    visible: ['eeeeeeee-0000-4000-8000-00000000000a'],
    hidden: ['eeeeeeee-0000-4000-8000-00000000000b'],
  },
  {
    table: 'tournaments',
    key: 'id',
    visible: ['77777777-0000-4000-8000-00000000000a'],
    hidden: [
      '77777777-0000-4000-8000-00000000000b',
      '77777777-0000-4000-8000-00000000000c',
      '77777777-0000-4000-8000-00000000000d',
    ],
  },
  {
    table: 'phases',
    key: 'id',
    visible: ['99999999-0000-4000-8000-00000000000a'],
    hidden: ['99999999-0000-4000-8000-00000000000b', '99999999-0000-4000-8000-00000000000c'],
  },
  {
    table: 'matches',
    key: 'id',
    visible: ['dddddddd-0000-4000-8000-00000000000a'],
    hidden: ['dddddddd-0000-4000-8000-00000000000b', 'dddddddd-0000-4000-8000-00000000000c'],
  },
  {
    table: 'registrations',
    key: 'id',
    visible: ['cccccccc-0000-4000-8000-00000000000a'],
    hidden: ['cccccccc-0000-4000-8000-00000000000c'],
  },
  {
    table: 'referee_assignments',
    key: 'id',
    visible: [
      '4a000000-0000-4000-8000-00000000001a',
      '4a000000-0000-4000-8000-00000000002a',
      '4a000000-0000-4000-8000-00000000003a',
    ],
    hidden: [
      '4a000000-0000-4000-8000-00000000001b',
      '4a000000-0000-4000-8000-00000000002c',
      '4a000000-0000-4000-8000-00000000003c',
    ],
  },
  {
    table: 'leagues',
    key: 'id',
    visible: ['1eaa0000-0000-4000-8000-00000000000a'],
    hidden: ['1eaa0000-0000-4000-8000-00000000000b'],
  },
  {
    table: 'penalty_rulesets',
    key: 'id',
    visible: [],
    hidden: ['fe000000-0000-4000-8000-00000000000a'],
  },
  {
    table: 'penalty_ruleset_entries',
    key: 'id',
    visible: [],
    hidden: ['fe100000-0000-4000-8000-00000000000a'],
  },
  {
    table: 'custom_rulesets',
    key: 'id',
    visible: [],
    hidden: ['c5000000-0000-4000-8000-00000000000a'],
  },
  {
    table: 'organization_members',
    key: 'user_id',
    visible: [],
    hidden: ['11111111-1111-4111-8111-111111111111'],
  },
  {
    table: 'platform_roles',
    key: 'user_id',
    visible: [],
    hidden: ['22222222-2222-4222-8222-222222222222'],
  },
];

/**
 * Columns neither public role may read, even on a row its policy shows. A column rule, not a row rule:
 * the policy cannot hide one field, so the table grant is split per column (0205).
 */
export const PRIVATE_COLUMNS = [
  // The reasons an organiser confirmed over (W1): "attends a Workshop" names a private enrolment.
  { table: 'referee_assignments', column: 'conflicts_jsonb' },
];

/**
 * Tables only the API writes: no write grant for either public role, so a direct write through
 * PostgREST fails loudly rather than touching no row in silence. Each names a seeded row.
 */
export const API_ONLY_WRITES = [
  // Every door that writes a referee asks the one checker and the lock (ADR-016, ADR-019).
  { table: 'referee_assignments', key: 'id', row: '4a000000-0000-4000-8000-00000000002a' },
  // Past the API's permission checks, link review and scoring engine (0216): a League, its roles,
  // its links, and the results and standings only the recompute writes.
  { table: 'leagues', key: 'id', row: '1eaa0000-0000-4000-8000-00000000000a' },
  { table: 'league_organization_roles', key: 'id', row: '1eab0000-0000-4000-8000-00000000000a' },
  { table: 'league_user_roles', key: 'id', row: '1eac0000-0000-4000-8000-00000000000a' },
  { table: 'league_tournament_links', key: 'id', row: '1ead0000-0000-4000-8000-00000000000a' },
  { table: 'league_tournament_results', key: 'id', row: '1eae0000-0000-4000-8000-00000000000a' },
  { table: 'league_rankings', key: 'id', row: '1eaf0000-0000-4000-8000-00000000000a' },
  // A fighter's medals, past the API's year and rank checks (0223).
  { table: 'fighter_manual_medals', key: 'id', row: 'ed000000-0000-4000-8000-00000000000a' },
  // A club scoring ruleset and its snapshots, past the edit guard and the review of sharing (0225).
  { table: 'custom_rulesets', key: 'id', row: 'c5000000-0000-4000-8000-00000000000a' },
  { table: 'custom_ruleset_versions', key: 'id', row: 'c5100000-0000-4000-8000-00000000000a' },
  // A penalty ruleset, its entries and its snapshots, past the edit guard of one in use (0226).
  { table: 'penalty_rulesets', key: 'id', row: 'fe000000-0000-4000-8000-00000000000a' },
  { table: 'penalty_ruleset_entries', key: 'id', row: 'fe100000-0000-4000-8000-00000000000a' },
  { table: 'penalty_ruleset_versions', key: 'id', row: 'fe200000-0000-4000-8000-00000000000a' },
];
/** The seeded organisation admin of the probe club (rls-probe-seed.sql). */
export const ORG_ADMIN = '11111111-1111-4111-8111-111111111111';
