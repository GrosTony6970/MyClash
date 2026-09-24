/**
 * The Tournament status is the only switch that shows a Tournament's contents
 * to the public (migration 0200, operator ruling 91).
 *
 * A phase used to carry its own `visibility_status`. Generating Pools or a
 * bracket created it `hidden`, and only republishing the Tournament showed it, so RLS
 * silently hid the day's bouts from the live channel while the public pages
 * showed them. Every public branch below now reads the Event status AND the
 * Tournament status, and the phase flag is gone.
 *
 * This reads the migrations in order and asserts each policy's LAST statement
 * WHOLE, so a dropped `and`, a widened status list or a revived phase flag
 * cannot pass as a substring. It cannot see the running database;
 * `pnpm db:migrations:replay` and a probe as `anon` cover that.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const migrationsDir = join(__dirname, '..', 'migrations');

function allSql(): string {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8').replace(/--[^\n]*/g, ''))
    .join('\n');
}

const flat = (text: string | null | undefined) =>
  (text ?? '').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim().toLowerCase();

/** The last CREATE POLICY statement for `name`, up to its semicolon. */
function policyStatement(sql: string, name: string): string {
  const pattern = new RegExp(`create\\s+policy\\s+"${name}"[\\s\\S]*?;`, 'gi');
  return flat([...sql.matchAll(pattern)].map((hit) => hit[0]).at(-1));
}

const PUBLIC =
  "(e.status in ('published','running','completed') " +
  "and t.status in ('published','running','completed'))";

/** A table whose rows hang off a phase, reached through `alias.phase_id`. */
const byPhase = (table: string, from: string, where: string) =>
  `create policy "${table}_select" on ${table} for select using (is_super_admin() or exists ` +
  `(select 1 from ${from} join tournaments t on t.id = ph.tournament_id ` +
  `join events e on e.id = t.event_id where ${where} and (is_org_member(e.organization_id) ` +
  `or ${PUBLIC})));`;

const EXPECTED: Record<string, string> = {
  phases_select:
    'create policy "phases_select" on phases for select using (is_super_admin() or exists ' +
    '(select 1 from tournaments t join events e on e.id = t.event_id ' +
    'where t.id = phases.tournament_id and (is_org_member(e.organization_id) ' +
    `or ${PUBLIC})));`,
  pools_select: byPhase('pools', 'phases ph', 'ph.id = pools.phase_id'),
  pool_members_select: byPhase(
    'pool_members',
    'pools p join phases ph on ph.id = p.phase_id',
    'p.id = pool_members.pool_id',
  ),
  bracket_slots_select: byPhase('bracket_slots', 'phases ph', 'ph.id = bracket_slots.phase_id'),
  matches_select: byPhase('matches', 'phases ph', 'ph.id = matches.phase_id'),
  match_events_select: byPhase(
    'match_events',
    'matches m join phases ph on ph.id = m.phase_id',
    'm.id = match_events.match_id',
  ),
  exchanges_select: byPhase(
    'exchanges',
    'matches m join phases ph on ph.id = m.phase_id',
    'm.id = exchanges.match_id',
  ),
  swiss_rounds_select: byPhase('swiss_rounds', 'phases ph', 'ph.id = swiss_rounds.phase_id'),
  swiss_entrants_select: byPhase('swiss_entrants', 'phases ph', 'ph.id = swiss_entrants.phase_id'),
  match_penalties_select:
    'create policy "match_penalties_select" on match_penalties for select using ' +
    '(is_org_member(match_penalty_event_org_id(match_id)) or exists (select 1 from matches m ' +
    'join phases p on p.id = m.phase_id join tournaments t on t.id = p.tournament_id ' +
    'join events e on e.id = t.event_id where m.id = match_id and ' +
    `${PUBLIC.slice(1, -1)}));`,
};

describe('the Tournament status is the public switch for its contents', () => {
  const sql = allSql();

  it.each(Object.entries(EXPECTED))(
    '%s shows the public a published Tournament only',
    (name, expected) => {
      expect(policyStatement(sql, name)).toBe(expected);
    },
  );

  it("drops the phase's own flag, so no reader can honour it again", () => {
    const lastAdd = Math.max(
      -1,
      ...[...sql.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?visibility_status\b/gi)].map(
        (hit) => hit.index,
      ),
    );
    const lastDrop = Math.max(
      -1,
      ...[...sql.matchAll(/drop\s+column\s+(?:if\s+exists\s+)?visibility_status\b/gi)].map(
        (hit) => hit.index,
      ),
    );
    expect(lastDrop).toBeGreaterThan(lastAdd);
  });
});
