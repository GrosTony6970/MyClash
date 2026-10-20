/**
 * A jsonb literal a migration names: the one line that ends `-- literal: <name>`, holding one
 * `'{…}'::jsonb`. Read where TypeScript restates the same value (a start value of the forfeit rules,
 * 0235) and where the replay probe checks the row a migration wrote, so neither copy can drift from
 * the migration unseen.
 *
 * Exactly one migration FILE may tag a name: none or several fail by name, so a renumbered or a
 * split migration is found by its content, never its number. Inside it the same name may tag
 * several lines (a column DEFAULT and a temporary DEFAULT that repeats it): identical values
 * collapse, different ones fail by name. Read with `JSON.parse`, never evaluated.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The migrations, found from this file: a caller's working directory says nothing. */
export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../packages/db/migrations',
);

const JSONB_LITERAL = /'(\{[^']*\})'::jsonb/u;

/** The lines of `sql` that end with the tag of `name`. */
function taggedLines(sql, name) {
  const tag = `-- literal: ${name}`;
  return sql.split(/\r?\n/u).filter((line) => line.trimEnd().endsWith(tag));
}

/** The value of the literal `name` and the migration that holds it. */
export function migrationLiteral(name, dir = MIGRATIONS_DIR) {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => ({ file, lines: taggedLines(readFileSync(path.join(dir, file), 'utf8'), name) }))
    .filter(({ lines }) => lines.length > 0);
  if (files.length !== 1) {
    const named = files.map(({ file }) => file).join(', ') || 'none';
    throw new Error(`literal "${name}": ${files.length} migrations tag it (${named}), not 1`);
  }
  const [{ file, lines }] = files;
  const values = lines.map((line) => {
    const found = JSONB_LITERAL.exec(line);
    if (!found) throw new Error(`literal "${name}" in ${file}: a tagged line holds no jsonb`);
    return JSON.stringify(JSON.parse(found[1]));
  });
  const distinct = [...new Set(values)];
  if (distinct.length !== 1) {
    throw new Error(`literal "${name}" in ${file}: ${distinct.length} different values`);
  }
  return { file, value: JSON.parse(distinct[0]) };
}
