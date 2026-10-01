/**
 * Reading ONE PostgREST select string: its own columns, and its embeds.
 *
 * Test-support only, and the half of the scanner that knows no TypeScript: `supabase-query-scan.ts`
 * finds the chains in a source file and hands each select string here. Split from it to keep both
 * inside the 400-line budget.
 */

/** Index just past the string starting at `start` (a quote character). */
export function skipQuoted(src: string, start: number): number {
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
export function closingParen(src: string, open: number): number {
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
export function splitTopLevel(body: string, separator: string): string[] {
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

export function bump(counts: Record<string, number>, reason: string): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

// ── Column extraction ────────────────────────────────────────────────────────

export const PLAIN_COLUMN = /^[a-z_][a-z0-9_]*$/;

/**
 * The columns a PostgREST select string names ON THE TABLE ITSELF.
 *
 * Anything carrying `(`, `:`, `!` or `.` belongs to an embedded relation, an
 * alias or an aggregate, and is skipped — see the header of `supabase-query-scan.ts`.
 */
export function columnsFromSelect(select: string, skipped: Record<string, number>): string[] {
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

/** `persons`, `persons!inner`, `red:registrations!some_fkey`: an embed's head. */
const EMBED_HEAD = /^(?:[A-Za-z_][A-Za-z0-9_]*:)?([a-z_][a-z0-9_]*)(?:![a-z_][a-z0-9_]*)*$/;

/**
 * The embeds a select string carries, each with its plain columns and its own embeds.
 *
 * As cowardly as the rest: a head that is not `[alias:]name[!hint]` (an aggregate such as
 * `cost_eur.sum()`) is skipped whole, and inside an embed only plain names count.
 */
export function embedsFromSelect(select: string, skipped: Record<string, number>): EmbedNode[] {
  const embeds: EmbedNode[] = [];
  for (const raw of splitTopLevel(select, ',')) {
    const part = raw.trim();
    const open = part.indexOf('(');
    if (open === -1) continue;
    const head = EMBED_HEAD.exec(part.slice(0, open).replace(/\s+/g, ''));
    if (!head || closingParen(part, open) !== part.length - 1) {
      bump(skipped, 'embed unparsed');
      continue;
    }
    const body = part.slice(open + 1, -1);
    embeds.push({
      target: head[1]!,
      columns: columnsFromSelect(body, skipped),
      embeds: embedsFromSelect(body, skipped),
    });
  }
  return embeds;
}

/**
 * One embed of a select string, `[alias:]target[!hint](…)`, as it is WRITTEN.
 *
 * Syntax only. `target` is a table most of the time, and behind an alias it can be a foreign-key
 * column of the parent (`leagues:league_id(id, name)`): which one is a question for the schema, so
 * the caller answers it. The scanner used to skip every embed, and a column no table has sat inside
 * three of them: PostgREST refuses the whole read, and a mocked Supabase never does.
 */
export interface EmbedNode {
  target: string;
  /** The plain columns asked of the embedded table. */
  columns: string[];
  /** The embeds nested in this one. */
  embeds: EmbedNode[];
}
