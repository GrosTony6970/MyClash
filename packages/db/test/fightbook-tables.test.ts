/**
 * FightBook (slice 1): the switch on the fighter profile and the three closed tables. Read from the
 * migrations as one text, so a later migration that drops one of these reds here. The running
 * database is `pnpm db:fightbook-probe`'s and `pnpm db:rls-probe`'s.
 */
import { describe, expect, it } from 'vitest';
import { allSql, flat } from './migration-sql';

const sql = flat(allSql());
const TABLES = ['spar_requests', 'spar_private_notes', 'fightbook_blocks'] as const;

/** The text of one named CHECK, up to the next constraint or column. */
function checkText(name: string): string {
  const at = sql.indexOf(`constraint ${name} check`);
  expect(at, `constraint ${name}`).toBeGreaterThan(-1);
  return sql.slice(at, sql.indexOf(' end)', at) + 5);
}

describe('FightBook tables', () => {
  it('adds the FightBook switch to the fighter profile, off by default', () => {
    expect(sql).toContain('add column fightbook_enabled boolean not null default false');
  });

  it.each(TABLES)('creates %s with RLS on and no policy', (table) => {
    expect(sql).toContain(`create table if not exists public.${table} (`);
    expect(sql).toContain(`alter table public.${table} enable row level security`);
    expect(sql).not.toMatch(new RegExp(`create policy[^;]*on (public\\.)?${table}\\b`));
  });

  it('keeps a request when its Event is deleted', () => {
    expect(sql).toContain('event_id uuid references public.events(id) on delete set null');
  });

  it.each([
    'spar_requests_two_fighters',
    'spar_requests_kind_shape',
    'spar_requests_status_shape',
    'spar_requests_cancelled_by',
    'fightbook_blocks_two_fighters',
  ])('writes %s as a CASE that refuses what it does not name', (name) => {
    const text = checkText(name);
    expect(text).toContain('case');
    expect(text).toContain('else false end');
  });

  it('allows one waiting request per asker and receiver', () => {
    expect(sql).toContain(
      'create unique index if not exists spar_requests_one_pending_uk on public.spar_requests (asker_global_person_id, receiver_global_person_id) where status = ',
    );
  });

  it('allows one block per pair and one private note per writer and request', () => {
    expect(sql).toContain(
      'create unique index if not exists fightbook_blocks_pair_uk on public.fightbook_blocks (blocker_global_person_id, blocked_global_person_id)',
    );
    expect(sql).toContain(
      'create unique index if not exists spar_private_notes_author_uk on public.spar_private_notes (spar_request_id, author_global_person_id)',
    );
  });
});
