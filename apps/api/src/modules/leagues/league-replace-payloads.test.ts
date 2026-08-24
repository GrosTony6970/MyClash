import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LeagueRankingRow, LeagueTournamentContribution } from '@myclash/rules/results';
import { toRankingPayload, toTournamentResultPayload } from './league-replace-payloads';

/**
 * The rpc payloads against the migration that expands them.
 *
 * Nothing else holds this seam. The Supabase double ignores an rpc payload
 * entirely, and `db-schema-conformance.test.ts` reads only
 * `.from(...).select(...)` — it has never looked at `.rpc()`. So renaming a key
 * on either side leaves every suite green and breaks a league recompute in
 * production, silently, because the row simply arrives with a NULL column.
 *
 * Shaped after `league-scoring.migration-parity.test.ts`: read the source of
 * truth, read the restatement, compare.
 */

const MIGRATIONS_DIR = join(process.cwd(), '..', '..', 'packages', 'db', 'migrations');

function readReplaceMigration(): string {
  const file = readdirSync(MIGRATIONS_DIR).find((name) =>
    /^\d{4}_league_replace_functions\.sql$/u.test(name),
  );
  // Refuses to find nothing: a renamed migration must red this, not skip it.
  expect(file, 'no *_league_replace_functions.sql in packages/db/migrations').toBeTruthy();
  return readFileSync(join(MIGRATIONS_DIR, file as string), 'utf8');
}

/**
 * The field list of one `jsonb_to_recordset(...) as r(...)` — the columns the
 * function expects each payload row to carry, in declaration order.
 */
function recordsetFields(sql: string, functionName: string): string[] {
  const body = sql.slice(sql.indexOf(`function public.${functionName}(`));
  const start = body.indexOf('jsonb_to_recordset');
  expect(start, `${functionName} does not expand a recordset`).toBeGreaterThan(-1);
  const open = body.indexOf('as r(', start);
  const close = body.indexOf(')', open + 'as r('.length);
  return body
    .slice(open + 'as r('.length, close)
    .split(',')
    .map((entry) => entry.trim().split(/\s+/u)[0] ?? '')
    .filter(Boolean);
}

const RANKING: LeagueRankingRow = {
  leagueId: 'L1',
  rankingGroupKey: 'longsword',
  fighterId: 'gp-1',
  fighterName: 'Ann A',
  clubName: null,
  clubCity: null,
  rank: 1,
  totalPoints: 30,
  participationCount: 2,
  medalCount: 1,
  doubleHitsTotal: 4,
  doubleHitAverage: 2,
  perTournament: [],
};

const CONTRIBUTION: LeagueTournamentContribution = {
  leagueId: 'L1',
  tournamentId: 't1',
  eventId: 'e1',
  fighterId: 'gp-1',
  fighterName: 'Ann A',
  clubName: null,
  clubCity: null,
  rankingGroupKey: 'longsword',
  weapon: 'Longsword',
  groupName: null,
  finalRank: 1,
  leaguePoints: 25,
  medal: 'gold',
  doubleHits: 3,
};

describe('league replace payloads match migration 0190', () => {
  it('the rankings payload carries exactly the fields the function expands', () => {
    const fields = recordsetFields(readReplaceMigration(), 'replace_league_rankings');

    expect(fields.length).toBeGreaterThan(0);
    expect([...fields].sort()).toEqual(Object.keys(toRankingPayload(RANKING)).sort());
  });

  it('the tournament-results payload carries exactly the fields the function expands', () => {
    const fields = recordsetFields(readReplaceMigration(), 'replace_league_tournament_results');

    expect(fields.length).toBeGreaterThan(0);
    expect([...fields].sort()).toEqual(Object.keys(toTournamentResultPayload(CONTRIBUTION)).sort());
  });

  it('neither payload carries a scoping column the function takes as a parameter', () => {
    // league_id and tournament_id come from the parameters so the insert is
    // scoped exactly like the delete. A payload carrying them would be a second
    // source for the same value.
    expect(Object.keys(toRankingPayload(RANKING))).not.toContain('league_id');
    const result = Object.keys(toTournamentResultPayload(CONTRIBUTION));
    expect(result).not.toContain('league_id');
    expect(result).not.toContain('tournament_id');
  });

  it('the ratio is sent as text, because the column is text', () => {
    expect(toRankingPayload({ ...RANKING, doubleHitAverage: 1.5 })).toMatchObject({
      double_hit_average: '1.5',
    });
  });
});
