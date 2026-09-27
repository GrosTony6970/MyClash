/**
 * A referee's availability is ticks only, on calendar dates, with one window per day (migration
 * 0210, W1.5, rulings 145-147).
 *
 * The two "available for all" switches go: no row = available always. A day row names a date, not
 * an index off the Event's first day, so moving the Event keeps it. Each day row may carry one
 * from–to window, held to `0 <= from < to <= 1440` by a CHECK. This reads the migrations in order
 * and asserts the LAST word on each, so a later migration that brings one back reds here.
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

const addsColumn = (table: string, column: string) =>
  lastIndex(
    (s) =>
      (s.startsWith(`alter table ${table} `) &&
        new RegExp(`add column (if not exists )?${column}\\b`).test(s)) ||
      (s.startsWith(`create table`) &&
        new RegExp(` ${table} \\(`).test(s) &&
        new RegExp(`[(,] ?${column} `).test(s)),
  );

describe('the availability switches and the day index', () => {
  it.each([
    ['event_referees', 'available_all_tournaments'],
    ['event_referees', 'available_all_event_duration'],
    ['event_referee_days', 'day_index'],
  ])('%s.%s is dropped, and not added back', (table, column) => {
    const dropped = lastIndex(
      (s) => s.startsWith(`alter table ${table} `) && s.includes(`drop column ${column}`),
    );
    expect(dropped).toBeGreaterThan(-1);
    expect(addsColumn(table, column)).toBeLessThan(dropped);
  });
});

describe('event_referee_days: a date, and one window', () => {
  it('backfills the date from the index it replaces, before the index goes', () => {
    const backfill = lastIndex(
      (s) =>
        s ===
        'update event_referee_days d set day = e.start_date::date + d.day_index from events e where e.id = d.event_id',
    );
    const indexDropped = lastIndex(
      (s) => s.startsWith('alter table event_referee_days ') && s.includes('drop column day_index'),
    );
    expect(backfill).toBeGreaterThan(addsColumn('event_referee_days', 'day'));
    expect(indexDropped).toBeGreaterThan(backfill);
  });

  it('keys a row by its date', () => {
    const key = lastIndex(
      (s) =>
        s ===
        'alter table event_referee_days add constraint event_referee_days_pkey primary key (event_id, person_id, day)',
    );
    const keyDropped = lastIndex(
      (s) =>
        s.startsWith('alter table event_referee_days ') &&
        s.includes('drop constraint event_referee_days_pkey'),
    );
    expect(key).toBeGreaterThan(keyDropped);
    expect(keyDropped).toBeGreaterThan(-1);
  });

  it('holds both minutes or neither, from before to, inside one day — and nothing drops it', () => {
    const check = lastIndex(
      (s) =>
        s ===
        'alter table event_referee_days add constraint event_referee_days_window_check check ( (from_minute is null and to_minute is null) or ( from_minute is not null and to_minute is not null and from_minute >= 0 and from_minute < to_minute and to_minute <= 1440 ) )',
    );
    const dropped = lastIndex(
      (s) =>
        s.startsWith('alter table event_referee_days ') &&
        (s.includes('drop constraint event_referee_days_window_check') ||
          s.includes('drop column from_minute') ||
          s.includes('drop column to_minute')),
    );
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(addsColumn('event_referee_days', 'to_minute'));
    expect(dropped).toBeLessThan(check);
  });
});
