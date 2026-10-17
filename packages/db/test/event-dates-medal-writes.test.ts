/**
 * An Event's dates are dates, a medal's year starts at 2000, and only the API writes medals
 * (migration 0223, O6).
 *
 * `events.start_date` / `end_date` were TEXT, so free text was stored as given; `fighter_manual_medals`
 * held its year at the API only, and its fighter could write it through PostgREST past the API's
 * checks. This reads the migrations in order and asserts the LAST word on each, so a later migration
 * that turns a date back into text, drops a CHECK, or brings a medal write policy or grant back reds
 * here. The running database is `pnpm db:rls-probe`'s (API_ONLY_WRITES, as the seeded organisation
 * admin).
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

const onTable = (statement: string, table: string) =>
  new RegExp(` on ${table} `).test(`${statement} `);

describe("an Event's dates", () => {
  it.each(['start_date', 'end_date'])(
    '%s is a DATE, and no later migration retypes it',
    (column) => {
      const retyped = lastIndex(
        (s) => s.startsWith('alter table events ') && s.includes(`alter column ${column} type `),
      );
      expect(retyped).toBeGreaterThan(-1);
      expect(statements[retyped]).toContain(
        `alter column ${column} type date using ${column}::date`,
      );
    },
  );

  it('holds the end on or after the start, and no later migration drops the CHECK', () => {
    const added = lastIndex(
      (s) =>
        s.startsWith('alter table events ') &&
        s.includes('add constraint events_end_not_before_start check (end_date >= start_date)'),
    );
    const dropped = lastIndex(
      (s) => s.includes('drop constraint') && s.includes('events_end_not_before_start'),
    );
    expect(added).toBeGreaterThan(-1);
    expect(dropped).toBeLessThan(added);
  });
});

describe("a fighter's medals", () => {
  it('hold a year from 2000, and no later migration drops the CHECK', () => {
    const added = lastIndex((s) =>
      s.includes('add constraint fighter_manual_medals_year_floor check (year >= 2000)'),
    );
    const dropped = lastIndex(
      (s) => s.includes('drop constraint') && s.includes('fighter_manual_medals_year_floor'),
    );
    expect(added).toBeGreaterThan(-1);
    expect(dropped).toBeLessThan(added);
  });

  it('lose their write policy, and no later migration creates one', () => {
    const dropped = lastIndex(
      (s) => s === 'drop policy "fighter_manual_medals_write" on fighter_manual_medals',
    );
    const created = lastIndex(
      (s) =>
        s.startsWith('create policy') &&
        onTable(s, 'fighter_manual_medals') &&
        !/ for select /.test(`${s} `),
    );
    expect(dropped).toBeGreaterThan(-1);
    expect(created).toBeLessThan(dropped);
  });

  it('are written by neither public role, and no later grant brings a write back', () => {
    const revoked = lastIndex(
      (s) =>
        s === 'revoke insert, update, delete on fighter_manual_medals from anon, authenticated',
    );
    const granted = lastIndex(
      (s) =>
        s.startsWith('grant') &&
        /\bon (table )?(public\.)?([a-z_]+, )*fighter_manual_medals[ ,]/.test(`${s} `) &&
        /\b(insert|update|delete|all)\b/.test(s.split(' on ')[0]!),
    );
    expect(revoked).toBeGreaterThan(-1);
    expect(granted).toBeLessThan(revoked);
  });
});
