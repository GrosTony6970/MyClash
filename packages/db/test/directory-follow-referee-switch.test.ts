/**
 * A hub follow carries one switch, "notify when refereeing", OFF at first (migration 0218, operator
 * rulings 217, 217a).
 *
 * A follow made from the People hub is keyed on the profile, and a referee taken from the
 * directory has no roster row in the Event: nothing could ring for his follower. The switch lives
 * on the hub follow itself. Its default is the safe value: a path that inserts a hub follow and
 * forgets the column asks for no alert.
 *
 * This reads the migrations in order and asserts the LAST word on the column. That the database
 * holds it so is read back from the catalog on a replayed Postgres (CI: Database replay).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const migrationsDir = join(__dirname, '..', 'migrations');

const statements = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
  .map((file) => readFileSync(join(migrationsDir, file), 'utf8').replace(/--[^\n]*/g, ''))
  .join('\n')
  .split(';')
  .map((text) => text.replace(/\s+/g, ' ').trim().toLowerCase())
  .filter((text) => text !== '');

/** Every statement that names the column on the hub follows, in migration order. */
const aboutTheSwitch = statements.filter(
  (s) => /\bdirectory_follows\b/.test(s) && /\bnotify_referee_start\b/.test(s),
);

describe('the hub follow switch "notify when refereeing"', () => {
  it('is a column of directory_follows, never null, off at first', () => {
    expect(aboutTheSwitch).toEqual([
      'alter table directory_follows add column notify_referee_start boolean not null default false',
    ]);
  });
});
