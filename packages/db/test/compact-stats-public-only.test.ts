/**
 * The "My groups" card stats count public Tournaments of public Events only (migration 0214,
 * ruling 163: a page spanning many Events shows public things only, for everyone).
 *
 * `compact_fighter_stats` counted a completed bout of a draft Tournament, and an Event whose only
 * entry was a draft Tournament's, on every viewer's card. This reads the migrations in order and
 * pins the LAST definition: Tournaments published, running or completed (`PUBLIC_TOURNAMENT_STATUSES`),
 * Events not draft (`isPublicEvent`: an archived Event stays public) and standard — and the
 * double-loss rule of 0192 kept. What it returns is checked on a replayed Postgres.
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

const OPENER = /create\s+or\s+replace\s+function\s+(public\.)?compact_fighter_stats\s*\(/i;

/** The last definition of `compact_fighter_stats`, up to its closing `$$;`. */
function lastDefinition(): { file: string; body: string } {
  const file = files.filter((candidate) => OPENER.test(sqlOf(candidate))).at(-1);
  expect(file, 'no migration defines compact_fighter_stats').toBeDefined();
  const sql = sqlOf(file!);
  const start = sql.search(OPENER);
  const end = sql.indexOf('$$;', sql.indexOf('$$', start) + 2);
  return { file: file!, body: flat(sql.slice(start, end + 3)) };
}

describe('compact_fighter_stats counts public Tournaments of public Events only', () => {
  it('reads only a published, running or completed Tournament of a standard Event not in draft', () => {
    const { file, body } = lastDefinition();
    expect(file).toBe('0214_compact_fighter_stats_public_only.sql');
    expect(body).toContain(
      "where pe.global_person_id = any(p_ids) and e.event_kind = 'standard' and e.status <> 'draft' and t.status in ('published', 'running', 'completed')",
    );
    // The bouts and the attended Events are read from those entries, not from registrations.
    expect(body).toContain('from regs rg join matches m');
    expect(body.match(/from registrations /g)).toHaveLength(1);
  });

  it('keeps the double loss of 0192 and the signature the API calls', () => {
    const { body } = lastDefinition();
    expect(body).toContain("or m.end_reason = 'max_doubles'");
    expect(body).toContain(
      'compact_fighter_stats(p_ids uuid[]) returns table (global_person_id uuid, matches int, wins int, losses int, events_attended int)',
    );
  });
});
