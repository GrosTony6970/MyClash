import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The live database schema, replayed from `packages/db/migrations` in order.
 *
 * Test-support only — nothing in the running API imports this. It exists
 * because the API names tables and columns in **strings**, and a mocked
 * Supabase happily returns rows for a column that was dropped years ago. Only
 * the migrations disagree.
 *
 * REPLAYING IS THE WHOLE POINT. A naive "does this identifier appear anywhere
 * in the SQL" grep says `referee_assignments.user_id` exists — because the
 * migration that DROPS it names it. Applying `CREATE TABLE`,
 * `ADD/RENAME/DROP COLUMN` and `ALTER TABLE … RENAME TO` in filename order is
 * what turns that into a real answer.
 *
 * Extracted from `modules/privacy/subject-export.schema.test.ts`, which was the
 * first caller and still owns its own assertions. Two copies of a parser is two
 * parsers to keep honest, and the second one always rots.
 */

export interface ReplayedSchema {
  /** table name → live column names, both lower-cased. */
  columns: Map<string, Set<string>>;
  /**
   * table name → the subset of those columns declared `JSON`/`JSONB`.
   *
   * Populated by the same replay, so a JSON column that was later dropped or
   * renamed is handled exactly as `columns` handles it. Callers that must reason
   * about what is INSIDE a column — the archive's nested-id coverage gate — need
   * to know which columns can hold anything nested at all.
   */
  jsonColumns: Map<string, Set<string>>;
  /**
   * View names, recorded WITHOUT columns. A view's columns come from a SELECT
   * list this parser has no business interpreting, so callers must treat a view
   * as opaque rather than report every column on it as missing.
   */
  views: Set<string>;
}

export function findMigrationsDir(): string {
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

/** `public.matches` and `Matches` are the same table as far as this is concerned. */
export const normaliseTable = (table: string): string =>
  table.replace(/^public\./i, '').toLowerCase();

/**
 * Remove `--` and block comments, preserving offsets and string literals.
 *
 * Must happen BEFORE any splitting, and it is not cosmetic. A column comment
 * routinely documents a JSONB shape:
 *
 *   -- { groupNumber, refNumber, shortName, description, sanctions, sortOrder }
 *   entries JSONB NOT NULL DEFAULT '[]'::jsonb,
 *
 * Those commas are top-level to a splitter, so the real `entries` column got
 * swallowed into a fragment beginning `sortOrder }` and was recorded as a
 * column named `sortorder` instead. Three tables lost a column that way, and
 * every query naming one looked like a violation. A `;` or an unbalanced `(`
 * inside a comment does the same damage to the ALTER and CREATE scanners.
 *
 * Dollar-quoted bodies (`$$ … $$`) are stepped over untouched: they are
 * function source, they legitimately contain `--` and `;`, and nothing here
 * parses them.
 */
function stripSqlComments(sql: string): string {
  const out = sql.split('');
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < sql.length) {
    const char = sql[i]!;
    if (char === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      blank(i, end === -1 ? sql.length : end);
      i = end === -1 ? sql.length : end;
    } else if (char === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      blank(i, end === -1 ? sql.length : end + 2);
      i = end === -1 ? sql.length : end + 2;
    } else if (char === "'") {
      i++;
      while (i < sql.length && sql[i] !== "'") i += sql[i] === '\\' ? 2 : 1;
      i++;
    } else if (char === '$') {
      const tag = /^\$[a-z_]*\$/i.exec(sql.slice(i, i + 32))?.[0];
      const end = tag ? sql.indexOf(tag, i + tag.length) : -1;
      i = tag && end !== -1 ? end + tag.length : i + 1;
    } else i++;
  }
  return out.join('');
}

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
  jsonColumns: Map<string, Set<string>>;
  views: Set<string>;
  /** `declaration` is whatever follows the column name; only its first token
   *  is read, so a `CHECK (… ::jsonb)` further along cannot fake a JSON type. */
  add: (table: string, column: string, declaration?: string) => void;
  drop: (table: string, column: string) => void;
  renameTable: (from: string, to: string) => void;
}

/** Is the first token of this declaration a JSON type? */
function declaresJson(declaration: string | undefined): boolean {
  const type = /^\s*(?:public\.)?([a-z_][a-z0-9_]*)/i.exec(declaration ?? '')?.[1];
  return type?.toLowerCase() === 'json' || type?.toLowerCase() === 'jsonb';
}

/** Column names declared in every `CREATE TABLE` in one migration. */
function applyCreateTables(sql: string, schema: SchemaBuilder): void {
  const createRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:public\.)?[a-z_][a-z0-9_]*)\s*\(/gi;
  for (let match = createRe.exec(sql); match; match = createRe.exec(sql)) {
    const open = match.index + match[0].length - 1;
    for (const part of splitTopLevel(balanced(sql, open))) {
      const line = part.trim();
      if (!line) continue;
      if (/^(CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|EXCLUDE|LIKE)\b/i.test(line)) {
        continue;
      }
      const name = /^"?([a-z_][a-z0-9_]*)"?/i.exec(line);
      if (name) schema.add(match[1]!, name[1]!, line.slice(name[0].length));
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
      /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?([^,;]*)/gi,
    )) {
      schema.add(table, added[1]!, added[2]);
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
    schema.views.add(normaliseTable(match[1]!));
  }
}

let cached: ReplayedSchema | null = null;

/**
 * table → live column names, replayed over the migrations IN ORDER so a later
 * DROP COLUMN actually removes what an earlier CREATE TABLE added.
 *
 * Memoised: the replay reads ~150 files, and a caller scanning 1600 query sites
 * would otherwise pay for it once per assertion.
 */
export function buildMigrationSchema(): ReplayedSchema {
  if (cached) return cached;

  const columns = new Map<string, Set<string>>();
  const jsonColumns = new Map<string, Set<string>>();
  const schema: SchemaBuilder = {
    columns,
    jsonColumns,
    views: new Set<string>(),
    add: (table, column, declaration) => {
      const key = normaliseTable(table);
      if (!columns.has(key)) columns.set(key, new Set());
      columns.get(key)!.add(column.toLowerCase());
      if (!declaresJson(declaration)) return;
      if (!jsonColumns.has(key)) jsonColumns.set(key, new Set());
      jsonColumns.get(key)!.add(column.toLowerCase());
    },
    drop: (table, column) => {
      columns.get(normaliseTable(table))?.delete(column.toLowerCase());
      jsonColumns.get(normaliseTable(table))?.delete(column.toLowerCase());
    },
    renameTable: (from, to) => {
      const [oldKey, newKey] = [normaliseTable(from), normaliseTable(to)];
      for (const index of [columns, jsonColumns]) {
        const moved = index.get(oldKey);
        if (!moved) continue;
        index.set(newKey, new Set([...(index.get(newKey) ?? []), ...moved]));
        index.delete(oldKey);
      }
    },
  };

  const dir = findMigrationsDir();
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const sql = stripSqlComments(readFileSync(path.join(dir, file), 'utf8'));
    applyCreateTables(sql, schema);
    applyViews(sql, schema);
    applyAlterTables(sql, schema);
  }

  cached = { columns, jsonColumns, views: schema.views };
  return cached;
}
