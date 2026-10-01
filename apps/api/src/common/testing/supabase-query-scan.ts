import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  bump,
  closingParen,
  columnsFromSelect,
  embedsFromSelect,
  PLAIN_COLUMN,
  skipQuoted,
  splitTopLevel,
  type EmbedNode,
} from './supabase-select-parse';

export type { EmbedNode } from './supabase-select-parse';

/**
 * Which (table, column) pairs does the API actually name in its PostgREST calls?
 *
 * Test-support only. Pairs with `migration-schema.ts` to answer the question a
 * mocked Supabase can never answer: the API addresses 124 tables through
 * ~1600 `.from('…')` string literals, and a mock returns rows for a column that
 * was dropped three years ago just as happily as for one that exists.
 *
 * THE SCANNER IS DELIBERATELY COWARDLY. PostgREST select strings carry embeds
 * (`'*, penalty_ruleset_entries(*)'` — a TABLE, not a column), aliases
 * (`'leagues:league_id(id, name)'`), aggregates (`'sum:cost_eur.sum()'`), hints
 * (`'persons!inner(…)'`) and dotted paths that walk an embed
 * (`.eq('matches.phases.tournament_id', …)`). None of those name a column on
 * the table `.from()` opened, so none is counted as one. An embed is handed
 * over as written (`EmbedRoot`), for the caller to resolve against the schema;
 * the rest is SKIPPED rather than guessed at.
 *
 * That cowardice is only safe because the caller asserts a FLOOR on the
 * resolved count. Without it, a parser that quietly stopped understanding
 * anything would report zero violations and look like success.
 */

/** Chain methods whose FIRST argument is a column name on the `.from()` table. */
const COLUMN_FIRST_ARG = new Set([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'is',
  'in',
  'like',
  'ilike',
  'not',
  'order',
  'contains',
]);

/** Chain methods whose first argument is a row literal whose KEYS are columns. */
const ROW_LITERAL_ARG = new Set(['insert', 'update', 'upsert']);

/**
 * Verbs that make a `.from()` chain a PostgREST query at all.
 *
 * This is what separates a real query from `Buffer.from(name, 'utf8')` and from
 * `supabase.service.storage.from(BUCKET)` — a storage BUCKET is not a table, and
 * its chain goes on to `.upload()`/`.getPublicUrl()`, never to `.select()`.
 * Structural, so it cannot be defeated by a new helper with a `from` method.
 */
const POSTGREST_VERBS = new Set(['select', 'insert', 'update', 'upsert', 'delete']);

export interface ColumnRef {
  table: string;
  column: string;
  file: string;
  line: number;
}

/** The embeds of one select, under the table its `.from()` opened. */
export interface EmbedRoot {
  table: string;
  file: string;
  line: number;
  embeds: EmbedNode[];
}

export interface ScanCounts {
  /** `.from('literal')` chains that looked like PostgREST queries. */
  chains: number;
  /** Column mentions this scanner declined to resolve, by reason. */
  skipped: Record<string, number>;
}

export interface ScanResult {
  refs: ColumnRef[];
  embeds: EmbedRoot[];
  counts: ScanCounts;
}

// ── Lexing ───────────────────────────────────────────────────────────────────

/**
 * Blank out comments and the INSIDE of interpolated template literals, preserving offsets.
 *
 * Offsets must survive because line numbers are reported back to a human. and
 * template bodies are blanked rather than dropped so a `${...}` holding its own
 * `.from('x')` cannot be mistaken for a top-level chain.
 *
 * A template with no `${…}` is kept: it is as static as a quoted string, and it is how a
 * multi-line select is written, which is where the embeds are.
 */
function blankNoise(src: string): string {
  const out = src.split('');
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const end = src.indexOf('\n', i);
      blank(i, end === -1 ? src.length : end);
      i = end === -1 ? src.length : end;
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      blank(i, end === -1 ? src.length : end + 2);
      i = end === -1 ? src.length : end + 2;
    } else if (src[i] === "'" || src[i] === '"') {
      i = skipQuoted(src, i);
    } else if (src[i] === '`') {
      const end = skipQuoted(src, i);
      if (src.slice(i, end).includes('${')) blank(i + 1, end - 1);
      i = end;
    } else i++;
  }
  return out.join('');
}

// ── Chain walking ────────────────────────────────────────────────────────────

interface ChainCall {
  name: string;
  args: string;
}

/**
 * The `.method(...)` calls chained directly onto the expression ending at `from`.
 *
 * Stops at the first thing that is not a method call — `;`, `as unknown as X`,
 * a closing paren — which is exactly where the query ends.
 */
function walkChain(src: string, from: number): ChainCall[] {
  const calls: ChainCall[] = [];
  let i = from;
  for (;;) {
    while (i < src.length && /\s/.test(src[i]!)) i++;
    if (src[i] !== '.') return calls;
    let j = i + 1;
    while (j < src.length && /\s/.test(src[j]!)) j++;
    const name = /^[a-zA-Z_$][\w$]*/.exec(src.slice(j, j + 48))?.[0];
    if (!name) return calls;
    let k = j + name.length;
    while (k < src.length && /\s/.test(src[k]!)) k++;
    if (src[k] !== '(') return calls;
    const close = closingParen(src, k);
    if (close === -1) return calls;
    calls.push({ name, args: src.slice(k + 1, close) });
    i = close + 1;
  }
}

/**
 * The first argument when it is a string literal, else null. Literals joined by `+` are one
 * string: a long select is written that way, and reading its first piece alone dropped every
 * embed after it. A template counts when it interpolates nothing; one that does arrives here
 * blanked, and is no literal.
 */
function firstStringArg(args: string): string | null {
  let rest = args.trimStart();
  let text = '';
  for (;;) {
    if (rest[0] !== "'" && rest[0] !== '"' && rest[0] !== '`') return null;
    const end = skipQuoted(rest, 0);
    const piece = rest.slice(1, end - 1);
    if (rest[0] === '`' && !piece.trim()) return null;
    text += piece;
    rest = rest.slice(end).trimStart();
    if (rest[0] !== '+') return text;
    rest = rest.slice(1).trimStart();
  }
}

/**
 * Top-level keys of a row literal, or null when the literal is not statically
 * knowable — a spread (`{ ...buildRow(x), is_frozen: true }` is real, in
 * `penalty-version.util.ts`), a computed key, or a value built at runtime.
 */
function keysOfRowLiteral(args: string): string[] | null {
  const trimmed = args.trim();
  const bodies: string[] = [];
  if (trimmed.startsWith('{')) {
    const end = matchingBrace(trimmed, 0);
    if (end === -1) return null;
    bodies.push(trimmed.slice(1, end));
  } else if (trimmed.startsWith('[')) {
    const inner = trimmed.slice(1, Math.max(1, matchingBrace(trimmed, 0)));
    for (const element of splitTopLevel(inner, ',')) {
      const object = element.trim();
      if (!object.startsWith('{')) return null;
      const end = matchingBrace(object, 0);
      if (end === -1) return null;
      bodies.push(object.slice(1, end));
    }
  } else return null;

  const keys: string[] = [];
  for (const body of bodies) {
    for (const raw of splitTopLevel(body, ',')) {
      const entry = raw.trim();
      if (!entry) continue;
      if (entry.startsWith('...') || entry.startsWith('[')) return null;
      const key = splitTopLevel(entry, ':')[0]!.trim();
      const unquoted = key[0] === "'" || key[0] === '"' ? key.slice(1, -1) : key;
      if (!PLAIN_COLUMN.test(unquoted)) return null;
      keys.push(unquoted);
    }
  }
  return keys;
}

/** Index of the bracket closing the one at `open` (`{`/`[`), or -1. */
function matchingBrace(src: string, open: number): number {
  const closeOf: Record<string, string> = { '{': '}', '[': ']' };
  const openChar = src[open]!;
  const closeChar = closeOf[openChar]!;
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const char = src[i]!;
    if (char === "'" || char === '"' || char === '`') {
      i = skipQuoted(src, i);
      continue;
    }
    if (char === openChar) depth++;
    else if (char === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

// ── Scanning ─────────────────────────────────────────────────────────────────

const FROM_LITERAL = /\.from\(\s*'([a-z_][a-z0-9_]*)'\s*\)/g;
/** `Buffer.from('…')` / `Array.from('…')` are not queries. */
const NOT_A_QUERY_RECEIVER = /\b(Buffer|Array|storage)\s*$/;

/** The columns ONE chain call names, or `[]` when it names none resolvably. */
function columnsFromCall(call: ChainCall, counts: ScanCounts): string[] {
  if (call.name === 'select') {
    const literal = firstStringArg(call.args);
    if (literal === null) {
      if (call.args.trim()) bump(counts.skipped, 'select not a literal');
      return [];
    }
    return columnsFromSelect(literal, counts.skipped);
  }

  if (COLUMN_FIRST_ARG.has(call.name)) {
    // `.order('x', { referencedTable: 'y' })` orders an EMBED's column.
    if (call.name === 'order' && /referencedTable|foreignTable/.test(call.args)) {
      bump(counts.skipped, 'order on embedded table');
      return [];
    }
    const column = firstStringArg(call.args);
    if (column === null) {
      bump(counts.skipped, `${call.name}() not a literal`);
      return [];
    }
    if (PLAIN_COLUMN.test(column)) return [column];
    bump(counts.skipped, `${call.name}() dotted/complex path`);
    return [];
  }

  if (ROW_LITERAL_ARG.has(call.name)) {
    const keys = keysOfRowLiteral(call.args);
    if (keys !== null) return keys;
    bump(counts.skipped, `${call.name}() row not a static literal`);
  }

  return [];
}

/**
 * Every resolvable (table, column) pair one source file names. The embeds of its selects go to
 * `embeds`, as written: resolving them needs the schema.
 */
export function scanSource(
  source: string,
  file: string,
  counts: ScanCounts,
  embeds: EmbedRoot[] = [],
): ColumnRef[] {
  const src = blankNoise(source);
  const refs: ColumnRef[] = [];

  for (let match = FROM_LITERAL.exec(src); match; match = FROM_LITERAL.exec(src)) {
    if (NOT_A_QUERY_RECEIVER.test(src.slice(Math.max(0, match.index - 24), match.index))) continue;

    const table = match[1]!;
    const calls = walkChain(src, match.index + match[0].length);
    if (!calls.some((call) => POSTGREST_VERBS.has(call.name))) continue;
    counts.chains++;

    const line = src.slice(0, match.index).split('\n').length;
    for (const call of calls) {
      for (const column of columnsFromCall(call, counts)) {
        refs.push({ table, column, file, line });
      }
      const select = call.name === 'select' ? firstStringArg(call.args) : null;
      const found = select === null ? [] : embedsFromSelect(select, counts.skipped);
      if (found.length > 0) embeds.push({ table, file, line, embeds: found });
    }
  }

  return refs;
}

/** Every `.ts` file under `dir`, minus tests and this support directory. */
export function apiSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      files.push(...apiSourceFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

/** Scan the whole API source tree. */
export function scanApiSources(root: string): ScanResult {
  const counts: ScanCounts = { chains: 0, skipped: {} };
  const refs: ColumnRef[] = [];
  const embeds: EmbedRoot[] = [];
  for (const file of apiSourceFiles(root)) {
    const source = readFileSync(file, 'utf8');
    refs.push(...scanSource(source, path.relative(root, file), counts, embeds));
  }
  return { refs, embeds, counts };
}
