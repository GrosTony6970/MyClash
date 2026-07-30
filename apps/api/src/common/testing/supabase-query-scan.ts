import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

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
 * the table `.from()` opened, so every one is SKIPPED rather than guessed at.
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

export interface ScanCounts {
  /** `.from('literal')` chains that looked like PostgREST queries. */
  chains: number;
  /** Column mentions this scanner declined to resolve, by reason. */
  skipped: Record<string, number>;
}

export interface ScanResult {
  refs: ColumnRef[];
  counts: ScanCounts;
}

// ── Lexing ───────────────────────────────────────────────────────────────────

/**
 * Blank out comments and the INSIDE of template literals, preserving offsets.
 *
 * Offsets must survive because line numbers are reported back to a human. and
 * template bodies are blanked rather than dropped so a `${...}` holding its own
 * `.from('x')` cannot be mistaken for a top-level chain.
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
      blank(i + 1, end - 1);
      i = end;
    } else i++;
  }
  return out.join('');
}

/** Index just past the string starting at `start` (a quote character). */
function skipQuoted(src: string, start: number): number {
  const quote = src[start];
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === '\\') i += 2;
    else if (src[i] === quote) return i + 1;
    else i++;
  }
  return src.length;
}

/** Index of the `)` closing the `(` at `open`, or -1. Quote-aware. */
function closingParen(src: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const char = src[i]!;
    if (char === "'" || char === '"' || char === '`') {
      i = skipQuoted(src, i);
      continue;
    }
    if (char === '(') depth++;
    else if (char === ')') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/** Top-level split on `separator`, ignoring anything nested or quoted. */
function splitTopLevel(body: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let i = 0;
  while (i < body.length) {
    const char = body[i]!;
    if (char === "'" || char === '"' || char === '`') {
      const end = skipQuoted(body, i);
      current += body.slice(i, end);
      i = end;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth++;
    if (char === ')' || char === ']' || char === '}') depth--;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
    } else current += char;
    i++;
  }
  parts.push(current);
  return parts;
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

/** The first argument when it is a plain string literal, else null. */
function firstStringArg(args: string): string | null {
  const trimmed = args.trimStart();
  if (trimmed[0] !== "'" && trimmed[0] !== '"') return null;
  const end = skipQuoted(trimmed, 0);
  return trimmed.slice(1, end - 1);
}

// ── Column extraction ────────────────────────────────────────────────────────

const PLAIN_COLUMN = /^[a-z_][a-z0-9_]*$/;

/**
 * The columns a PostgREST select string names ON THE TABLE ITSELF.
 *
 * Anything carrying `(`, `:`, `!` or `.` belongs to an embedded relation, an
 * alias or an aggregate, and is skipped — see the file header.
 */
function columnsFromSelect(select: string, skipped: Record<string, number>): string[] {
  const columns: string[] = [];
  for (const raw of splitTopLevel(select, ',')) {
    const part = raw.trim();
    if (!part || part === '*') continue;
    if (part.includes('(') || part.includes(':') || part.includes('!') || part.includes('.')) {
      bump(skipped, 'select embed/alias/aggregate');
      continue;
    }
    if (PLAIN_COLUMN.test(part)) columns.push(part);
    else bump(skipped, 'select unparsed');
  }
  return columns;
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

function bump(counts: Record<string, number>, reason: string): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
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

/** Every resolvable (table, column) pair one source file names. */
export function scanSource(source: string, file: string, counts: ScanCounts): ColumnRef[] {
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
  for (const file of apiSourceFiles(root)) {
    refs.push(...scanSource(readFileSync(file, 'utf8'), path.relative(root, file), counts));
  }
  return { refs, counts };
}
