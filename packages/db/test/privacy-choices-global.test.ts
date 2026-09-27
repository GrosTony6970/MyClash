/**
 * A person's privacy choices live on their GLOBAL person (migration 0211, rulings 132, 155, 156).
 *
 * `person_privacy` was keyed by the event-scoped `persons.id`: a competitor in five Events held five
 * answers, and a choice made before an Event existed never reached it. The two choices move to
 * `global_persons` (as 0187 did for the directory flag), folded to the stricter answer across a
 * person's rows; the third, `show_real_email_to_followers`, had no reader and goes with the table.
 * This reads the migrations in order and asserts the LAST word on each.
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

const dropped = lastIndex((s) => s === 'drop table person_privacy');

describe('the privacy choices on the global person', () => {
  it.each([
    ['hide_workshops_publicly boolean not null default false'],
    ['allow_being_followed boolean not null default true'],
  ])('global_persons gains %s', (column) => {
    const added = lastIndex(
      (s) => s.startsWith('alter table global_persons ') && s.includes(`add column ${column}`),
    );
    expect(added).toBeGreaterThan(-1);
  });

  it('folds every row of a person to the stricter answer, before the old table goes', () => {
    const fold = lastIndex(
      (s) =>
        s ===
        'update global_persons gp set hide_workshops_publicly = f.hide, allow_being_followed = f.allow ' +
          'from ( select p.global_person_id, bool_or(pp.hide_workshops_publicly) as hide, ' +
          'bool_and(pp.allow_being_followed) as allow from person_privacy pp ' +
          'join persons p on p.id = pp.person_id where p.global_person_id is not null ' +
          'group by p.global_person_id ) f where gp.id = f.global_person_id',
    );
    expect(fold).toBeGreaterThan(-1);
    expect(dropped).toBeGreaterThan(fold);
  });

  it('drops person_privacy, and nothing creates it again', () => {
    expect(dropped).toBeGreaterThan(-1);
    const created = lastIndex((s) => /^create table (if not exists )?person_privacy\b/.test(s));
    expect(created).toBeLessThan(dropped);
  });

  it('never moves the unused third choice', () => {
    const moved = lastIndex(
      (s) =>
        s.startsWith('alter table global_persons ') && s.includes('show_real_email_to_followers'),
    );
    expect(moved).toBe(-1);
  });
});
