/**
 * Two owners resolve a Tournament's card rules, and they must agree. The server's
 * `tournamentCardRulesetId` (`card-rules-pin.ts`) reads them Tournament → Event → built-in, for
 * the admin picker and for how far a black card reaches. The database's row
 * builder of a bout's copy of its rules (`build_match_rules`, migration 0229) pins them the same
 * way, and the copy decides the bout's cards once the readers switch to it. A predicate changed on
 * one side only gives a bout card rules the Tournament's page does not show.
 *
 * The SQL side runs live in the RLS probe (`scripts/lib/match-rules-probe.mjs`, its three pins).
 * Here: the TS side on the same three cases, and both sides' built-in predicate compared.
 */
import { describe, expect, it } from 'vitest';
import { lastFunctionBody } from '../../common/testing/migration-function';
import { filtersFor, mockSupabase } from '../../common/testing/supabase-chain';
import { tournamentCardRulesetId } from './card-rules-pin';

type Pins = { tournament: string | null; event: string | null };

/** A club's own row marked built-in comes first: only the owner filter keeps it out. */
const RULESETS = [
  { id: 'club-built-in', built_in: true, owner_organization_id: 'org-1' },
  { id: 'platform-built-in', built_in: true, owner_organization_id: null },
  { id: 'tournament-pin', built_in: false, owner_organization_id: 'org-1' },
  { id: 'event-pin', built_in: false, owner_organization_id: 'org-1' },
];

async function resolvedBy(pins: Pins) {
  const supabase = mockSupabase({
    tournaments: { rows: [{ id: 't-1', event_id: 'ev-1', penalty_ruleset_id: pins.tournament }] },
    events: { rows: [{ id: 'ev-1', penalty_ruleset_id: pins.event }] },
    penalty_rulesets: { rows: RULESETS },
  });
  const id = await tournamentCardRulesetId(supabase.service as never, 't-1');
  return { id, from: supabase.from };
}

/** `build_match_rules`' built-in read, as [column, test, value] and its limit. */
function sqlBuiltIn(body: string): { tests: unknown[][]; limit: number } {
  const read = /from public\.penalty_rulesets pr where (.+?) limit (\d+);/u.exec(body);
  if (!read) throw new Error('build_match_rules reads no built-in card ruleset');
  const tests = read[1]!.split(' and ').map((test) => {
    const flag = /^pr\.(\w+)$/u.exec(test);
    if (flag) return [flag[1], 'eq', true];
    const empty = /^pr\.(\w+) is null$/u.exec(test);
    if (empty) return [empty[1], 'is', null];
    throw new Error(`build_match_rules' built-in test "${test}" has no TS twin here: add one`);
  });
  return { tests, limit: Number(read[2]) };
}

const sorted = (tests: unknown[][]) =>
  [...tests].sort((a, b) => String(a[0]).localeCompare(String(b[0])));

describe("the card rules a bout's copy pins and the ones the server resolves", () => {
  it("both take the Tournament's pin first", async () => {
    expect((await resolvedBy({ tournament: 'tournament-pin', event: 'event-pin' })).id).toBe(
      'tournament-pin',
    );
    expect(lastFunctionBody('build_match_rules')).toContain(
      'if t.penalty_ruleset_id is not null then pin_id := t.penalty_ruleset_id;',
    );
  });

  it("both take the Event's pin when the Tournament has none", async () => {
    expect((await resolvedBy({ tournament: null, event: 'event-pin' })).id).toBe('event-pin');
    const body = lastFunctionBody('build_match_rules');
    const tournament = body.indexOf('if t.penalty_ruleset_id is not null');
    const event = body.indexOf('from public.events e where e.id = t.event_id;');
    expect(tournament).toBeGreaterThanOrEqual(0);
    expect(event).toBeGreaterThan(tournament);
  });

  it('both take the platform built-in last, by the same test', async () => {
    const { id, from } = await resolvedBy({ tournament: null, event: null });
    expect(id).toBe('platform-built-in');

    const body = lastFunctionBody('build_match_rules');
    expect(body.indexOf('if pin_id is null then')).toBeGreaterThan(
      body.indexOf('from public.events e'),
    );
    const sql = sqlBuiltIn(body);
    const ts = [
      ...filtersFor(from, 'penalty_rulesets', 'eq')
        .filter(([column]) => column !== 'id')
        .map(([column, value]) => [column, 'eq', value]),
      ...filtersFor(from, 'penalty_rulesets', 'is').map(([column, value]) => [column, 'is', value]),
    ];
    expect(sorted(ts)).toEqual(sorted(sql.tests));
    expect(filtersFor(from, 'penalty_rulesets', 'limit')).toEqual([[sql.limit]]);
  });
});
