import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUBJECT_EXPORT_TABLES } from './subject-export.tables';

/**
 * Does every column the subject export reads still EXIST?
 *
 * `subject-export.coverage.test.ts` guards the other direction — that no table
 * is silently missing from the export. This one guards the columns, and it
 * exists because the gap between them shipped a dead endpoint:
 *
 *   Migration 0063 dropped `user_id` from `referee_assignments`,
 *   `referee_qualifications` and `event_referees` ("Post-0063: there is no
 *   user_id column on..." — its own header). SUBJECT_EXPORT_TABLES kept
 *   declaring it. `fetchDirect` correctly refuses to swallow a PostgREST error,
 *   so `GET /me/data-export.zip` returned 500 for EVERY user — a GDPR Art. 15
 *   endpoint, dead in production.
 *
 * Nothing caught it: the coverage test only checks table names, and
 * `subject-export.service.test.ts` mocks Supabase, so a column that no longer
 * exists is a column the mock happily returns rows for. Only the real database
 * disagrees — which is why this test reads the migrations instead of a mock.
 */

function findMigrationsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), '../../packages/db/migrations'), // cwd = apps/api
    path.resolve(process.cwd(), 'packages/db/migrations'), // cwd = repo root
    path.resolve(__dirname, '../../../../packages/db/migrations'),
    path.resolve(__dirname, '../../../../../packages/db/migrations'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not locate packages/db/migrations (looked in: ${candidates.join(', ')})`);
}

const normalise = (table: string) => table.replace(/^public\./i, '').toLowerCase();

/** Top-level comma split, so a `NUMERIC(10,2)` doesn't look like two columns. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += char;
  }
  parts.push(current);
  return parts;
}

/** The body of the parenthesised block starting at `open`, without the parens. */
function balanced(sql: string, open: number): string {
  let depth = 1;
  let index = open + 1;
  for (; index < sql.length && depth > 0; index++) {
    if (sql[index] === '(') depth++;
    else if (sql[index] === ')') depth--;
  }
  return sql.slice(open + 1, index - 1);
}

interface SchemaBuilder {
  columns: Map<string, Set<string>>;
  views: Set<string>;
  add: (table: string, column: string) => void;
  drop: (table: string, column: string) => void;
  renameTable: (from: string, to: string) => void;
}

/** Column names declared in every `CREATE TABLE` in one migration. */
function applyCreateTables(sql: string, schema: SchemaBuilder): void {
  const createRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:public\.)?[a-z_][a-z0-9_]*)\s*\(/gi;
  for (let match = createRe.exec(sql); match; match = createRe.exec(sql)) {
    const open = match.index + match[0].length - 1;
    for (const part of splitTopLevel(balanced(sql, open))) {
      const line = part.replace(/--[^\n]*/g, '').trim();
      if (!line) continue;
      if (/^(CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|EXCLUDE|LIKE)\b/i.test(line)) {
        continue;
      }
      const name = /^"?([a-z_][a-z0-9_]*)"?/i.exec(line);
      if (name) schema.add(match[1]!, name[1]!);
    }
  }
}

/** `ALTER TABLE … ADD/RENAME/DROP COLUMN`, and whole-table renames, in order. */
function applyAlterTables(sql: string, schema: SchemaBuilder): void {
  const alterRe = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?((?:public\.)?[a-z_][a-z0-9_]*)([\s\S]*?);/gi;
  for (let match = alterRe.exec(sql); match; match = alterRe.exec(sql)) {
    const [table, tail] = [match[1]!, match[2]!];

    // `ALTER TABLE x RENAME TO y` — the whole table moves. Missing this is not
    // academic: 0023 renamed `fighters` to `global_persons`, and the subject
    // export went on querying `fighters` for years. Every column still "exists"
    // to a grep, because the old CREATE TABLE is still sitting in 0001.
    const renamedTo = /RENAME\s+TO\s+"?([a-z_][a-z0-9_]*)"?/i.exec(tail);
    if (renamedTo && !/RENAME\s+COLUMN/i.test(tail)) {
      schema.renameTable(table, renamedTo[1]!);
      continue;
    }
    for (const added of tail.matchAll(
      /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi,
    )) {
      schema.add(table, added[1]!);
    }
    for (const renamed of tail.matchAll(
      /RENAME\s+COLUMN\s+"?([a-z_][a-z0-9_]*)"?\s+TO\s+"?([a-z_][a-z0-9_]*)"?/gi,
    )) {
      schema.drop(table, renamed[1]!);
      schema.add(table, renamed[2]!);
    }
    for (const dropped of tail.matchAll(
      /DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi,
    )) {
      schema.drop(table, dropped[1]!);
    }
  }
}

/**
 * Views are opaque here: their columns come from a SELECT list this parser has
 * no business interpreting. Recorded only so they are not reported missing.
 */
function applyViews(sql: string, schema: SchemaBuilder): void {
  const viewRe =
    /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:public\.)?[a-z_][a-z0-9_]*)/gi;
  for (let match = viewRe.exec(sql); match; match = viewRe.exec(sql)) {
    schema.views.add(normalise(match[1]!));
  }
}

/**
 * table → live column names, replayed over the migrations IN ORDER so a later
 * DROP COLUMN actually removes what an earlier CREATE TABLE added. Replaying is
 * the whole point: a naive "does this identifier appear anywhere in the SQL"
 * grep says `referee_assignments.user_id` exists, because the migration that
 * drops it names it.
 */
function buildSchema(): { columns: Map<string, Set<string>>; views: Set<string> } {
  const columns = new Map<string, Set<string>>();
  const schema: SchemaBuilder = {
    columns,
    views: new Set<string>(),
    add: (table, column) => {
      const key = normalise(table);
      if (!columns.has(key)) columns.set(key, new Set());
      columns.get(key)!.add(column.toLowerCase());
    },
    drop: (table, column) => {
      columns.get(normalise(table))?.delete(column.toLowerCase());
    },
    renameTable: (from, to) => {
      const [oldKey, newKey] = [normalise(from), normalise(to)];
      const moved = columns.get(oldKey);
      if (!moved) return;
      columns.set(newKey, new Set([...(columns.get(newKey) ?? []), ...moved]));
      columns.delete(oldKey);
    },
  };

  const dir = findMigrationsDir();
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(path.join(dir, file), 'utf8');
    applyCreateTables(sql, schema);
    applyViews(sql, schema);
    applyAlterTables(sql, schema);
  }

  return { columns, views: schema.views };
}

const schema = buildSchema();

describe('subject export column schema', () => {
  /**
   * The parser is the test. If it silently understood nothing, every assertion
   * below would pass on an empty world — so pin one column it must have found
   * and one it must have seen REMOVED.
   */
  it('replays migrations accurately enough to be trusted', () => {
    expect(schema.columns.get('matches')).toContain('phase_id');
    expect(schema.columns.get('events')).toContain('slug');
    // Dropped by 0063. If this comes back, the DROP replay broke and every
    // other assertion here is worthless.
    expect(schema.columns.get('referee_assignments')).not.toContain('user_id');
    // Renamed to global_persons by 0023 — the rename replay must retire the old
    // name, or a map entry pointing at a table that no longer exists reads as
    // fine (which is exactly how the export stayed broken).
    expect(schema.columns.has('fighters')).toBe(false);
    expect(schema.columns.get('global_persons')).toContain('claimed_by_user_id');
  });

  it('declares no column that the schema does not have', () => {
    const missing: string[] = [];
    for (const [table, spec] of Object.entries(SUBJECT_EXPORT_TABLES)) {
      const key = normalise(table);
      if (schema.views.has(key)) continue;
      const known = schema.columns.get(key);
      if (!known) {
        missing.push(`${table} (no CREATE TABLE in any migration)`);
        continue;
      }
      for (const { column } of spec.reaches) {
        if (!known.has(column.toLowerCase())) missing.push(`${table}.${column}`);
      }
    }
    expect(
      missing,
      'SUBJECT_EXPORT_TABLES reads columns that no longer exist; the export 500s on every one of them',
    ).toEqual([]);
  });
});
