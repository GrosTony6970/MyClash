/**
 * The parameter names a database function is LAST defined with, read from
 * `packages/db/migrations` in order.
 *
 * A Supabase double ignores an `.rpc()` payload, so a key renamed on either side reaches
 * PostgREST as a call to a function that does not exist, with every suite green. A test
 * compares its payload's keys with this list. Refuses to find nothing.
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
  const definition = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(([^)]*)\\)`,
    'iu',
  );
  const params = readdirSync(MIGRATIONS)
    .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
    .sort()
    .map((file) => definition.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'))?.[1])
    .filter((found): found is string => found !== undefined)
    .at(-1);
  if (params === undefined) throw new Error(`no migration defines public.${name}`);
  return params
    .split(',')
    .map((entry) => entry.trim().split(/\s+/u)[0] ?? '')
    .filter(Boolean);
}
