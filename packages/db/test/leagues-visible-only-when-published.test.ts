/**
 * A League is publicly visible only when it is published (migration 0215, ruling 88).
 *
 * The anon policies on `leagues`, `league_rankings` and `league_tournament_results` (0015) read
 * `public_visibility` only, while the public pages also ask for `status = 'published'`. A draft or
 * archived League set visible by anything but `LeaguesService.update` was world-readable through
 * PostgREST while every page answered "not found". This reads the migrations in order and pins the
 * CHECK that ties the two, the resync that runs before it, and that no later migration drops it.
 * What it refuses is checked on a replayed Postgres by `pnpm db:rls-probe` (check 6).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const migrationsDir = join(__dirname, '..', 'migrations');

const files = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
const sqlOf = (file: string) =>
  readFileSync(join(migrationsDir, file), 'utf8').replace(/--[^\n]*/g, '');
const flat = (text: string) =>
  text.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim().toLowerCase();

const NAME = 'leagues_visible_only_when_published';
const statements = files.flatMap((file) =>
  flat(sqlOf(file))
    .split(';')
    .map((statement) => ({ file, statement: statement.trim() }))
    .filter(({ statement }) => statement.length > 0),
);

describe('a League is publicly visible only when it is published', () => {
  it('adds the CHECK once, and no later migration drops it', () => {
    const naming = statements.filter(({ statement }) => statement.includes(NAME));
    expect(naming).toEqual([
      {
        file: '0215_leagues_visible_only_when_published.sql',
        statement: `alter table leagues add constraint ${NAME} check (not public_visibility or status = 'published')`,
      },
    ]);
  });

  it('first takes the flag off a visible League that is not published, making nothing public', () => {
    const inFile = statements.filter(
      ({ file }) => file === '0215_leagues_visible_only_when_published.sql',
    );
    expect(inFile.map(({ statement }) => statement)).toEqual([
      "update leagues set public_visibility = false, updated_at = now() where public_visibility and status <> 'published'",
      `alter table leagues add constraint ${NAME} check (not public_visibility or status = 'published')`,
    ]);
  });
});
