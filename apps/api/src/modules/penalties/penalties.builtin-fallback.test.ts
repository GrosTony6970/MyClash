import { describe, expect, it, vi } from 'vitest';
import { PenaltiesService } from './penalties.service';

/**
 * The platform default a match or tournament falls back to when nobody pinned a
 * penalty ruleset — which is the normal state of almost every event.
 *
 * It resolved by a hard-coded `(code, version)` pair, asking for version '2026'
 * while migration 0054 seeds the built-in as '1.0.0'. The filter matched
 * nothing, `maybeSingle()` returned null, and `GET /matches/:id/penalty-ruleset`
 * served the scoring pad an empty ruleset: no entries, so no penalty buttons,
 * so a referee could not card anyone. Found by `16-pad-ui.spec.ts`, which tried
 * to click a card and found none to click.
 *
 * The mock below FILTERS rows the way PostgREST does, instead of returning a row
 * for any query. That is the whole point: a mock that answers every filter
 * identically cannot tell a matching predicate from a non-matching one, which is
 * exactly how a wrong version string survives. Here the seeded version is the
 * real one, so a resolver that asks for the wrong value gets null — as it did.
 */

type Row = Record<string, unknown>;

const BUILTIN: Row = {
  id: 'builtin-1',
  code: 'ffamhe_tf_2026',
  // The version migration 0054 actually seeds. Do not "fix" this to match a
  // constant — the row is the source of truth, and the resolver must not care.
  version: '1.0.0',
  owner_organization_id: null,
  built_in: true,
  name: 'Penalty - Tournois fédéraux FFAMHE',
  penalty_ruleset_entries: [
    { id: 'entry-1', group_number: 1, ref_number: '1', sanctions: ['yellow', 'red'] },
  ],
};

const ENTRY: Row = {
  id: 'entry-1',
  ruleset_id: 'builtin-1',
  group_number: 1,
  ref_number: '1',
  short_name: 'Sortie de Lice',
  sanctions: ['yellow', 'red'],
};

/** Rows for a match whose tournament and event both pin nothing. */
const TABLES = (): Record<string, Row[]> => ({
  matches: [
    {
      id: 'm-1',
      phase_id: 'ph-1',
      locked_at: null,
      red_registration_id: 'reg-red',
      blue_registration_id: 'reg-blue',
    },
  ],
  phases: [{ id: 'ph-1', tournament_id: 't-1' }],
  tournaments: [{ id: 't-1', event_id: 'ev-1', penalty_ruleset_id: null }],
  events: [{ id: 'ev-1', organization_id: 'org-1', penalty_ruleset_id: null }],
  penalty_rulesets: [BUILTIN],
  penalty_ruleset_entries: [ENTRY],
  match_penalties: [],
});

/** A Supabase double that actually applies `.eq()` / `.is()` to its rows. */
function filteringSupabase() {
  const inserted: Record<string, Row[]> = {};
  const tables = TABLES();
  const from = vi.fn((table: string) => {
    let rows = [...(tables[table] ?? [])];
    const chain: Record<string, unknown> = {
      select: vi.fn(() => chain),
      eq: vi.fn((column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] === value);
        return chain;
      }),
      is: vi.fn((column: string, value: unknown) => {
        rows = rows.filter((row) => (row[column] ?? null) === value);
        return chain;
      }),
      limit: vi.fn((n: number) => {
        rows = rows.slice(0, n);
        return chain;
      }),
      order: vi.fn(() => Promise.resolve({ data: rows, error: null })),
      insert: vi.fn((payload: Row) => {
        inserted[table] = [...(inserted[table] ?? []), payload];
        rows = [payload];
        return chain;
      }),
      single: vi.fn(() => Promise.resolve({ data: rows[0] ?? null, error: null })),
      maybeSingle: vi.fn(() => Promise.resolve({ data: rows[0] ?? null, error: null })),
    };
    return chain;
  });
  return { supabase: { service: { from } }, inserted };
}

const serviceUnderTest = () => new PenaltiesService(filteringSupabase().supabase as never);

describe('the built-in penalty ruleset every match falls back to', () => {
  it('resolves for a match whose tournament and event pin nothing', async () => {
    const ruleset = (await serviceUnderTest().getEffectiveRulesetForMatch('m-1')) as Row | null;

    expect(ruleset, 'a match with no pinned ruleset must still get the platform default').not.toBe(
      null,
    );
    expect(ruleset?.['id']).toBe('builtin-1');
  });

  it('carries its entries, which are what the pad renders as penalty buttons', async () => {
    const ruleset = (await serviceUnderTest().getEffectiveRulesetForMatch('m-1')) as Row | null;

    // A ruleset with no entries is indistinguishable from no ruleset on the pad:
    // the picker is empty either way and the referee cannot card anyone.
    expect(ruleset?.['penalty_ruleset_entries']).toHaveLength(1);
  });

  it('resolves the same way for a tournament', async () => {
    const ruleset = (await serviceUnderTest().getEffectiveRulesetForTournament(
      't-1',
    )) as Row | null;

    expect(ruleset?.['id']).toBe('builtin-1');
    expect(ruleset?.['penalty_ruleset_entries']).toHaveLength(1);
  });

  /**
   * The other half, and the one that stayed broken after the picker was fixed:
   * RECORDING a card from an entry the picker offered.
   *
   * `computeRulesetPenalty` refused outright unless a ruleset was explicitly
   * pinned, so the pad listed 28 entries and the server rejected every one of
   * them with "No penalty ruleset is attached to this tournament or event". The
   * read path and the write path each decided for themselves what the default
   * was; now both go through the effective id `getMatchContext` resolves.
   */
  it('records a card from the built-in, and keeps the ruleset it came from', async () => {
    const { supabase, inserted } = filteringSupabase();
    const service = new PenaltiesService(supabase as never);

    await service.createPenalty(
      'm-1',
      {
        clientUuid: 'a4f1b8e6-5c2d-4f7a-9b3e-1d0c8a5e6f2b',
        sequence: 1,
        registrationId: 'reg-blue',
        rulesetEntryId: 'entry-1',
        occurredAt: '2026-07-30T11:03:27.266Z',
        clockTimeMs: null,
      } as never,
      // A staff account skips the org-membership check; the ruleset resolution
      // under test is the same either way.
      { staffAccountId: 'staff-1' },
    );

    const row = inserted['match_penalties']?.[0];
    expect(row, 'the card must be recorded at all').toBeDefined();
    expect(row?.['registration_id']).toBe('reg-blue');
    // Provenance: a card that came from the built-in's entry must say so, not
    // store a null that makes it look like a manual referee card.
    expect(row?.['ruleset_id']).toBe('builtin-1');
    expect(row?.['ruleset_entry_id']).toBe('entry-1');
  });
});
