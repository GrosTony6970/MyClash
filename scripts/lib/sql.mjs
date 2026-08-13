/**
 * Blank out SQL comments before a gate reads the statements underneath.
 *
 * ── Why every SQL gate needs this ───────────────────────────────────────────
 * Migration headers in this repo are long prose, and they quote the DDL they
 * discuss. A gate reading raw text sees those sentences as declarations: 0184's
 * header explains `CREATE TABLE IF NOT EXISTS` and, read literally, declares a
 * table called "IF" with no RLS on it.
 *
 * Comments are blanked rather than deleted — a block comment becomes the same
 * number of spaces and newlines — so byte offsets and line numbers survive and
 * line-keyed output stays honest.
 *
 * ── Why it is shared ────────────────────────────────────────────────────────
 * This was hardened in check-db-review.mjs after prose was parsed as DDL, and
 * check-realtime-bindings.mjs kept a one-liner that replaced a leading double
 * dash to end of line and nothing else. Line comments are the easy half: a
 * slash-star block naming a table in ALTER PUBLICATION still read as a real
 * publication.
 *
 * That gate answers "is every table a client subscribes to actually published",
 * and an unpublished table in any binding puts the whole channel into permanent
 * CHANNEL_ERROR. A phantom publication picked up out of a comment makes it
 * answer yes for a table Postgres never publishes — a false green whose symptom
 * is realtime silently not firing in production.
 */
export function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, (line) => ' '.repeat(line.length));
}
