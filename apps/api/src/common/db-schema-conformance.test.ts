import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMigrationSchema, normaliseTable } from './testing/migration-schema';
import {
  scanApiSources,
  scanSource,
  type EmbedNode,
  type EmbedRoot,
  type ScanCounts,
} from './testing/supabase-query-scan';

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
 * ~6,400 pairs over ~1,800 chains resolve today. The floors sit ~20% under, so
 * ordinary churn never trips them but a parser that lost a whole construct
 * does. Raise them if they ever start looking generous — NEVER lower one to
 * make a change pass; that is the failure mode this guard exists to prevent.
 */
const MIN_RESOLVED_PAIRS = 5_000;
const MIN_CHAINS = 1_450;

/** ~1,070 pairs sit inside embeds today. Same rule as above: raise, never lower. */
const MIN_EMBEDDED_PAIRS = 950;

const schema = buildMigrationSchema();
const { refs, embeds, counts } = scanApiSources(API_SRC);

const emptyCounts = (): ScanCounts => ({ chains: 0, skipped: {} });

const isKnown = (table: string): boolean => schema.columns.has(table) || schema.views.has(table);

/** Does a foreign key of `from` point at `to`? */
const pointsAt = (from: string, to: string): boolean =>
  [...(schema.references.get(from)?.values() ?? [])].some(
    (key) => normaliseTable(key.table) === to,
  );

/**
 * The table an embed reads, or null when the migrations cannot say.
 *
 * Its target is a table, or a foreign-key column of the parent (`leagues:league_id(…)`), which
 * reads the table that key points at. A table is embedded through a foreign key, either way round:
 * with none, PostgREST refuses the read ("could not find a relationship"). A view has no key the
 * replay can see, so one is taken at its word. PostgREST also takes a constraint name or a
 * function as target; the replay knows neither, so those stay unresolved rather than guessed.
 */
function embedTable(parent: string | null, target: string): string | null {
  const named = normaliseTable(target);
  if (isKnown(named)) {
    const keyed = !parent || schema.views.has(parent) || schema.views.has(named);
    return keyed || pointsAt(parent, named) || pointsAt(named, parent) ? named : null;
  }
  const referenced = normaliseTable(
    (parent && schema.references.get(parent)?.get(target)?.table) || '',
  );
  // A key to a table the replay does not hold (`auth.users`) reads nothing that can be checked.
  return isKnown(referenced) ? referenced : null;
}

interface EmbedFindings {
  pairs: number;
  unresolved: string[];
  violations: string[];
}

/** Every column the embeds name, checked against the table each embed resolves to. */
function checkEmbeds(
  parent: string | null,
  nodes: readonly EmbedNode[],
  where: string,
  found: EmbedFindings,
): void {
  for (const node of nodes) {
    const table = embedTable(parent, node.target);
    if (!table) found.unresolved.push(`${node.target} — ${where}`);
    // A view's columns come from a SELECT list the replay does not read.
    const known = table && !schema.views.has(table) ? schema.columns.get(table) : undefined;
    for (const column of known ? node.columns : []) {
      found.pairs++;
      if (!known!.has(column)) found.violations.push(`${table}.${column} — ${where}`);
    }
    checkEmbeds(table, node.embeds, where, found);
  }
}

const embedded: EmbedFindings = { pairs: 0, unresolved: [], violations: [] };
for (const root of embeds) {
  checkEmbeds(normaliseTable(root.table), root.embeds, `${root.file}:${root.line}`, embedded);
}

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

  it('reads an embed as written: its target, its plain columns and the embeds inside it', () => {
    const found: EmbedRoot[] = [];
    scanSource(
      `this.supabase.service.from('matches')
         .select('id, lices ( name, label ), red:registrations!matches_red_registration_id_fkey(id, persons!inner(given_name, clubs(name))), leagues:league_id(id), sum:cost_eur.sum()');`,
      'fixture.ts',
      emptyCounts(),
      found,
    );
    const clubs = { target: 'clubs', columns: ['name'], embeds: [] };
    const persons = { target: 'persons', columns: ['given_name'], embeds: [clubs] };
    expect(found).toEqual([
      {
        table: 'matches',
        file: 'fixture.ts',
        line: 1,
        embeds: [
          { target: 'lices', columns: ['name', 'label'], embeds: [] },
          { target: 'registrations', columns: ['id'], embeds: [persons] },
          // The aggregate is no embed at all.
          { target: 'league_id', columns: ['id'], embeds: [] },
        ],
      },
    ]);
  });

  /** A long select is written as literals joined by `+`: the embeds sit in the later pieces. */
  it('reads a select written as joined literals as one string', () => {
    const found: EmbedRoot[] = [];
    const refs = scanSource(
      `this.supabase.service.from('matches')
         .select('id, status, ' + 'pools ( name ), ' + \`lice_id\`);
       this.supabase.service.from('matches').select('id, ' + COLUMNS);`,
      'fixture.ts',
      emptyCounts(),
      found,
    );
    expect(refs.map((ref) => ref.column)).toEqual(['id', 'status', 'lice_id']);
    expect(found.map((root) => root.embeds)).toEqual([
      [{ target: 'pools', columns: ['name'], embeds: [] }],
    ]);
  });

  it('resolves an embed to its table through the migrations, or not at all', () => {
    expect(embedTable('matches', 'lices')).toBe('lices');
    // Either way round: `lices` holds no key to `matches`, `matches.lice_id` points at it.
    expect(embedTable('lices', 'matches')).toBe('matches');
    // Behind an alias: a foreign-key column of the parent reads the table it points at.
    expect(embedTable('league_tournament_links', 'league_id')).toBe('leagues');
    // No key joins a bout to a venue: PostgREST would refuse the read.
    expect(embedTable('matches', 'venues')).toBeNull();
    // A key to `auth.users`, which the replay does not hold: nothing could be checked.
    expect(embedTable('league_scoring_systems', 'created_by_user_id')).toBeNull();
    expect(embedTable('matches', 'no_such_table')).toBeNull();
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
    console.log(`[db-schema-conformance] ${embedded.pairs} (table, column) pairs inside embeds`);
    expect(counts.chains).toBeGreaterThanOrEqual(MIN_CHAINS);
    expect(refs.length).toBeGreaterThanOrEqual(MIN_RESOLVED_PAIRS);
    expect(embedded.pairs).toBeGreaterThanOrEqual(MIN_EMBEDDED_PAIRS);
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

  /**
   * `lices ( name, label )` and `persons ( …, display_name )` lived here: a follower alert that was
   * never queued, a referee board that answered an error, a schedule board with no referee check.
   */
  it('names no column inside an embed that the embedded table does not have', () => {
    expect(
      embedded.violations.sort(),
      'an embed asks its table for a column it does not have; PostgREST 400s the whole query',
    ).toEqual([]);
  });

  it('names no embed the migrations cannot resolve to a table', () => {
    expect(
      embedded.unresolved.sort(),
      'an embed names no table a foreign key joins to its parent, and no foreign key of its parent: ' +
        'PostgREST refuses it, or nothing checks its columns. Name the table, or teach `embedTable`',
    ).toEqual([]);
  });

  it('reads the head of every embed', () => {
    expect(
      counts.skipped['embed unparsed'] ?? 0,
      'an embed whose head the scanner cannot read hides its columns: teach `EMBED_HEAD`',
    ).toBe(0);
  });
});
