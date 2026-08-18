/**
 * The `.or()` filter string, parsed.
 *
 * A separate file from the row narrowing on purpose: this one is a GRAMMAR and
 * holds no row logic, supabase-chain-seeded.ts holds the predicates and no
 * syntax. That seam is worth having — unlike the internals split, which exists
 * only to stay inside the line budget.
 *
 * PostgREST spells a disjunction as one string of sibling expressions:
 * `.or('a.eq.1,b.ilike.%x%')` is `a = 1 OR b ILIKE '%x%'`. Seventeen call sites
 * in eleven modules build one, so a seeded table that refused `or` forced every
 * one of those reads to stay canned, dropping their other filters to argument
 * assertions.
 *
 * ── What is modelled, and what throws ───────────────────────────────────────
 * `eq`, `neq`, `is`, `in` and `ilike`, plus `not` in front of `is`. Everything
 * else throws, in the same spirit as UNSIMULATED: a filter that quietly matched
 * more rows than Postgres would lets a test assert less than it appears to.
 *
 * The three shapes deliberately left out are the three no target needs yet —
 * `and(...)` groups (custom-rulesets, penalties), `like` (league-scoring-
 * systems), and range operators. Range is not an oversight: an `.or` value
 * arrives as TEXT, and ordering text is only the same as ordering the column
 * for strings and ISO instants, not for numbers, so `gte` here would be a
 * different comparison from `.gte()` on the same column.
 */

/**
 * Split on commas that separate SIBLINGS, not on commas inside a value.
 *
 * `red_id.in.(a,b),blue_id.in.(c)` is two terms, and naive splitting makes it
 * four — three of them unparseable, and the one that parses narrows on half a
 * list. Depth counting is the whole trick: `in.(…)` and `and(…)` are the only
 * things that nest, and both are parenthesised.
 */
function splitSiblings(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(source.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

/** The operators this module compares with. */
export type OrOperator = 'eq' | 'neq' | 'is' | 'in' | 'ilike';

const OPERATORS: ReadonlySet<string> = new Set<OrOperator>(['eq', 'neq', 'is', 'in', 'ilike']);

/** One sibling expression, ready to be turned into a row predicate. */
export interface OrTerm {
  column: string;
  operator: OrOperator;
  /** Only ever true for `is` — `not` in front of anything else throws. */
  negated: boolean;
  /** `null`/`true`/`false` for `is`, a string list for `in`, else the raw text. */
  value: unknown;
}

const refuse = (source: string, detail: string): Error =>
  new Error(
    `supabaseChain: or("${source}") is not simulated on a seeded table (${detail}). ` +
      `Model it in supabase-chain-or.ts, or seed this table with { data } if the filter is not what the test is about.`,
  );

/**
 * `is` compares against a keyword, never a value.
 *
 * `unknown` is deliberately refused rather than folded into null: they are the
 * same for a nullable column and different for a three-valued boolean, and
 * guessing which one a fixture meant is how a filter silently stops narrowing.
 */
function isKeyword(term: string, raw: string): boolean | null {
  if (raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw refuse(term, `is."${raw}"`);
}

/** `in.(a,b,c)` — the parentheses are part of the syntax, not the values. */
function inList(term: string, raw: string): string[] {
  if (!raw.startsWith('(') || !raw.endsWith(')')) throw refuse(term, `in without a (list)`);
  const body = raw.slice(1, -1);
  return body === '' ? [] : body.split(',');
}

/**
 * Read one sibling expression.
 *
 * The value is whatever follows the operator, dots included — emails and ilike
 * patterns both carry them, so only the first two segments may be split off.
 */
function parseTerm(term: string): OrTerm {
  if (term.includes('(') && !term.includes('.in.')) throw refuse(term, 'a nested and()/or() group');

  const firstDot = term.indexOf('.');
  if (firstDot < 1) throw refuse(term, 'not column.operator.value');
  const column = term.slice(0, firstDot);

  let rest = term.slice(firstDot + 1);
  const negated = rest.startsWith('not.');
  if (negated) rest = rest.slice(4);

  const nextDot = rest.indexOf('.');
  if (nextDot < 1) throw refuse(term, 'not column.operator.value');
  const operator = rest.slice(0, nextDot);
  const raw = rest.slice(nextDot + 1);

  if (!OPERATORS.has(operator)) throw refuse(term, `operator "${operator}"`);
  if (negated && operator !== 'is') throw refuse(term, `not.${operator}`);
  if (raw.startsWith('"')) throw refuse(term, 'a quoted value');

  const value =
    operator === 'is' ? isKeyword(term, raw) : operator === 'in' ? inList(term, raw) : raw;
  return { column, operator: operator as OrOperator, negated, value };
}

/**
 * Every sibling of an `.or()` string, in order.
 *
 * Throws rather than returning what it managed to read: a partially parsed
 * disjunction is a WIDER filter than the caller wrote, and a wider filter is
 * the one failure this double exists to prevent.
 */
export function parseOr(source: string): OrTerm[] {
  if (source.trim() === '') throw refuse(source, 'an empty filter string');
  return splitSiblings(source).map((term) => parseTerm(term));
}
