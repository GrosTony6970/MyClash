/**
 * The parameter names a database function is LAST defined with, read from
 * `packages/db/migrations` in order.
 *
 * A Supabase double ignores an `.rpc()` payload, so a key renamed on either side reaches
 * PostgREST as a call to a function that does not exist, with every suite green. A test
 * compares its payload's keys with this list. Refuses to find nothing.
 *
 * Also the body of that last definition, for a test that holds a TS twin to it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const MIGRATIONS = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'migrations',
);

export function lastFunctionParams(name: string): string[] {
  const params = lastDefinition(name, String.raw`\(([^)]*)\)`);
  return params
    .split(',')
    .map((entry) => entry.trim().split(/\s+/u)[0] ?? '')
    .filter(Boolean);
}

/**
 * The body of the function's last definition, between its dollar quotes, comments out, its
 * whitespace one space and lower case: for a test that holds a TS twin to what the SQL decides.
 */
export function lastFunctionBody(name: string): string {
  return lastDefinition(name, String.raw`\([\s\S]*?\$\$([\s\S]*?)\$\$`)
    .replace(/--[^\n]*/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

/** What `rest` captures after the name, in the last migration that defines it. */
function lastDefinition(name: string, rest: string): string {
  const definition = new RegExp(
    String.raw`create\s+or\s+replace\s+function\s+public\.${name}\s*` + rest,
    'iu',
  );
  const found = readdirSync(MIGRATIONS)
    .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
    .sort()
    .map((file) => definition.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'))?.[1])
    .filter((hit): hit is string => hit !== undefined)
    .at(-1);
  if (found === undefined) throw new Error(`no migration defines public.${name}`);
  return found;
}
