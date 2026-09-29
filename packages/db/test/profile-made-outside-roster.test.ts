/**
 * A global person records whether it was made outside a roster (migration 0213, rulings 176, 176a).
 *
 * A profile that stood on its own before any draft entry — claimed, or made by a super admin —
 * stays public whatever its entries; any other is public only through a public entry. The default
 * is false, so a path that forgets the column fails closed; the API sets true only on a super
 * admin's create and import. Existing profiles with no roster row were public already and are
 * marked. This reads the migrations in order and asserts the LAST word.
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

const lastIndex = (match: (statement: string) => boolean) =>
  statements.reduce((last, statement, index) => (match(statement) ? index : last), -1);

describe('the global person records whether it was made outside a roster', () => {
  it('global_persons gains made_outside_roster boolean not null default false', () => {
    const added = lastIndex(
      (s) =>
        s.startsWith('alter table global_persons ') &&
        s.includes('add column made_outside_roster boolean not null default false'),
    );
    expect(added).toBeGreaterThan(-1);
  });

  it('marks every existing profile with no roster row, after the column exists', () => {
    const added = lastIndex((s) => s.includes('add column made_outside_roster'));
    const backfill = lastIndex(
      (s) =>
        s ===
        'update global_persons gp set made_outside_roster = true where not exists (select 1 from persons p where p.global_person_id = gp.id)',
    );
    expect(backfill).toBeGreaterThan(added);
  });
});
