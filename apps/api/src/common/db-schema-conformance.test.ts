import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMigrationSchema, normaliseTable } from './testing/migration-schema';
import { scanApiSources, scanSource, type ScanCounts } from './testing/supabase-query-scan';

/**
 * Does every table and column the API NAMES actually exist?
 *
 * `modules/privacy/subject-export.schema.test.ts` asks this of one map, and it
 * exists because the gap shipped a dead GDPR endpoint. This asks it of the
 * whole API: ~1600 `.from('…')` literals across 124 tables, none of which any
 * other test can see, because every service test mocks Supabase — and a mock
 * returns rows for a dropped column exactly as happily as for a live one.
 *
 * Three of the last thirteen production bugs would have died here, offline, in
 * under a second:
 *
 *   - `referee_assignments.user_id`, dropped by migration 0063
 *   - `fighters`, renamed to `global_persons` by 0023
 *   - `matches.tournament_id`, which never existed
 *
 * The scanner (`testing/supabase-query-scan.ts`) skips everything it cannot
 * resolve with certainty, so THE FLOOR BELOW IS LOAD-BEARING: a parser that
 * quietly stopped understanding anything would report zero violations and read
 * as a pass. The floor is what makes silence mean something.
 */

const API_SRC = path.resolve(__dirname, '..');

/**
 * ~5,500 pairs over ~1,600 chains resolve today. The floors sit ~10% under, so
 * ordinary churn never trips them but a parser that lost a whole construct
 * does. Raise them if they ever start looking generous — NEVER lower one to
 * make a change pass; that is the failure mode this guard exists to prevent.
 */
const MIN_RESOLVED_PAIRS = 5_000;
const MIN_CHAINS = 1_450;

const schema = buildMigrationSchema();
const { refs, counts } = scanApiSources(API_SRC);

const emptyCounts = (): ScanCounts => ({ chains: 0, skipped: {} });

describe('the scanner understands PostgREST chains', () => {
  it('resolves a plain chain across all four column-bearing verbs', () => {
    const found = scanSource(
      `const x = await this.supabase.service
         .from('matches')
         .select('id, phase_id')
         .eq('lice_id', liceId)
         .order('scheduled_at', { ascending: true });
       await this.supabase.service
         .from('matches')
         .update({ red_score: 1, 'blue_score': 2 })
         .eq('id', id);`,
      'fixture.ts',
      emptyCounts(),
    );
    expect(found.map((ref) => `${ref.table}.${ref.column}`)).toEqual([
      'matches.id',
      'matches.phase_id',
      'matches.lice_id',
      'matches.scheduled_at',
      'matches.red_score',
      'matches.blue_score',
      'matches.id',
    ]);
  });

  /**
   * The cowardice, pinned. Every one of these names something that is NOT a
   * column on the opened table, and a scanner that resolved any of them would
   * report violations that are not real — which is how a test like this gets
   * switched off.
   */
  it('skips embeds, aliases, aggregates, hints, dotted paths and dynamic rows', () => {
    const skipCounts = emptyCounts();
    const found = scanSource(
      `this.supabase.service.from('tournaments')
         .select('*, leagues:league_id(id, name), persons!inner(global_person_id), sum:cost_eur.sum()')
         .eq('phases.tournament_id', id)
         .order('created_at', { referencedTable: 'phases' });
       this.supabase.service.from('tournaments').insert({ ...buildRow(x), id });
       this.supabase.service.from('tournaments').select(COLUMNS);`,
      'fixture.ts',
      skipCounts,
    );
    expect(found, 'nothing above names a column on `tournaments`').toEqual([]);
    expect(skipCounts.chains, 'all three are still recognised as queries').toBe(3);
  });

  it('ignores Buffer.from, Array.from and storage buckets', () => {
    const ignored = emptyCounts();
    const found = scanSource(
      `Buffer.from('deadbeef', 'hex');
       Array.from('abc');
       this.supabase.service.storage.from('event-logos').upload(p, f);`,
      'fixture.ts',
      ignored,
    );
    expect(found).toEqual([]);
    expect(ignored.chains).toBe(0);
  });
});

describe('every table and column the API names exists', () => {
  it('resolved enough of the API to be worth trusting', () => {
    // Printed, not just asserted: the skip tally is how a future reader tells
    // "the parser is conservative" from "the parser broke".
    const skipped = Object.entries(counts.skipped).sort((a, b) => b[1] - a[1]);
    console.log(
      `[db-schema-conformance] ${counts.chains} chains → ${refs.length} (table, column) pairs resolved; ` +
        `skipped: ${skipped.map(([reason, n]) => `${reason}=${n}`).join(', ') || 'none'}`,
    );
    expect(counts.chains).toBeGreaterThanOrEqual(MIN_CHAINS);
    expect(refs.length).toBeGreaterThanOrEqual(MIN_RESOLVED_PAIRS);
  });

  it('names no table that no migration creates', () => {
    const unknown = new Set<string>();
    for (const ref of refs) {
      const key = normaliseTable(ref.table);
      if (!schema.columns.has(key) && !schema.views.has(key)) {
        unknown.add(`${ref.table} (${ref.file}:${ref.line})`);
      }
    }
    expect(
      [...unknown].sort(),
      'the API queries a table no migration creates — every call site 404s at PostgREST',
    ).toEqual([]);
  });

  it('names no column the schema does not have', () => {
    const violations = new Set<string>();
    for (const ref of refs) {
      const key = normaliseTable(ref.table);
      // A view's columns come from a SELECT list the replay does not read.
      if (schema.views.has(key)) continue;
      const known = schema.columns.get(key);
      if (!known || known.has(ref.column.toLowerCase())) continue;
      violations.add(`${ref.table}.${ref.column} — ${ref.file}:${ref.line}`);
    }
    expect(
      [...violations].sort(),
      'the API reads or writes a column that does not exist; PostgREST 400s the whole query',
    ).toEqual([]);
  });
});
