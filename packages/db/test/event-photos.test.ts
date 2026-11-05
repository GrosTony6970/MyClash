/**
 * Event photos (migration 0249): the Event's photo mode and token version, the deny-all photo
 * table, and the counting function the upload checks before it reads a file. Read from the
 * migrations as one text, so a later migration that drops one of these reds here. The running
 * database is `pnpm db:rls-probe`'s.
 */
import { describe, expect, it } from 'vitest';
import { allSql, flat, functionStatement, triggerStatement } from './migration-sql';

const sql = flat(allSql());

describe('Event photos', () => {
  it('adds photo_mode with exactly off/live/approve, default off', () => {
    expect(sql).toContain("add column if not exists photo_mode text not null default 'off'");
    expect(sql).toContain("check (photo_mode in ('off','live','approve'))");
  });

  it('adds a positive photo_token_version, default 1', () => {
    expect(sql).toContain(
      'add column if not exists photo_token_version integer not null default 1 check (photo_token_version > 0)',
    );
  });

  it('creates event_photos with RLS on and no policy', () => {
    expect(sql).toContain('create table if not exists public.event_photos (');
    expect(sql).toContain('alter table public.event_photos enable row level security');
    expect(sql).not.toMatch(/create policy[^;]*on (public\.)?event_photos/);
  });

  it('cascades from its Event and detaches from a deleted Tournament or Workshop', () => {
    expect(sql).toContain('event_id uuid not null references public.events(id) on delete cascade');
    expect(sql).toContain(
      'tournament_id uuid references public.tournaments(id) on delete set null',
    );
    expect(sql).toContain('workshop_id uuid references public.workshops(id) on delete set null');
  });

  it('holds a photo to its limits in the table itself', () => {
    expect(sql).toContain("check (status in ('waiting','approved'))");
    expect(sql).toContain('char_length(uploader_name) between 1 and 40');
    expect(sql).toContain('char_length(caption) between 1 and 200');
    expect(sql).toContain('check (tournament_id is null or workshop_id is null)');
  });

  it('keeps event_photo_usage an invoker function, out of reach of web roles', () => {
    const fn = functionStatement(allSql(), 'event_photo_usage');
    expect(fn).toContain('security invoker');
    expect(fn).toContain('set search_path = public, pg_catalog');
    expect(sql).toContain(
      'revoke execute on function public.event_photo_usage(uuid, uuid) from public, anon, authenticated',
    );
    expect(sql).toContain(
      'grant execute on function public.event_photo_usage(uuid, uuid) to service_role',
    );
  });
});

/**
 * Event photo tombstones (migration 0250): every path that removes a photo row queues its two
 * image keys, in the same transaction, for the worker to delete from the bucket. The committed
 * cascade probe proves the paths on a running database.
 */
describe('Event photo tombstones', () => {
  const table = /create table if not exists public\.event_photo_tombstones \([\s\S]*?\n\);/i;

  it('creates event_photo_tombstones with RLS on, no policy and no foreign key', () => {
    const statement = flat(allSql().match(table)?.[0]);
    expect(statement).toContain('object_key text primary key');
    expect(statement).not.toContain('references');
    expect(sql).toContain('alter table public.event_photo_tombstones enable row level security');
    expect(sql).not.toMatch(/create policy[^;]*on (public\.)?event_photo_tombstones/);
  });

  it('queues both keys on every row delete', () => {
    expect(triggerStatement(allSql(), 'event_photos_tombstone_row')).toBe(
      'create trigger event_photos_tombstone_row after delete on public.event_photos for each row execute function public.event_photo_tombstone_row();',
    );
    const fn = functionStatement(allSql(), 'event_photo_tombstone_row');
    expect(fn).toContain('values (old.original_key), (old.preview_key) on conflict do nothing');
  });

  it('queues every key when the table is truncated', () => {
    expect(triggerStatement(allSql(), 'event_photos_tombstone_truncate')).toBe(
      'create trigger event_photos_tombstone_truncate before truncate on public.event_photos for each statement execute function public.event_photo_tombstone_all();',
    );
    const fn = functionStatement(allSql(), 'event_photo_tombstone_all');
    expect(fn).toContain('select original_key from public.event_photos');
    expect(fn).toContain('select preview_key from public.event_photos');
  });

  it.each(['event_photo_tombstone_row', 'event_photo_tombstone_all', 'event_photo_events'])(
    'keeps %s an invoker function with a pinned path, out of reach of web roles',
    (name) => {
      const fn = functionStatement(allSql(), name);
      expect(fn).toContain('security invoker');
      expect(fn).toContain('set search_path = public, pg_catalog');
      expect(sql).toMatch(
        new RegExp(
          `revoke execute on function public\\.${name}\\([^)]*\\) from public, anon, authenticated`,
        ),
      );
    },
  );

  it('creates event_photo_reports with RLS on, no policy, one row per photo and phone', () => {
    const statement = flat(
      allSql().match(
        /create table if not exists public\.event_photo_reports \([\s\S]*?\n\);/i,
      )?.[0],
    );
    expect(statement).toContain(
      'photo_id uuid not null references public.event_photos(id) on delete cascade',
    );
    expect(statement).toContain('primary key (photo_id, device_id)');
    expect(sql).toContain('alter table public.event_photo_reports enable row level security');
    expect(sql).not.toMatch(/create policy[^;]*on (public\.)?event_photo_reports/);
  });

  it('gives a report an optional comment of 1 to 200 characters, by a named check (ruling 452)', () => {
    expect(sql).toContain(
      'add column if not exists comment text null constraint event_photo_reports_comment_length check (comment is null or char_length(comment) between 1 and 200)',
    );
  });

  it('lists only the Events that still hold a photo, for the service role alone', () => {
    const fn = functionStatement(allSql(), 'event_photo_events');
    expect(fn).toContain('returns table (event_id uuid, end_date date, timezone text)');
    expect(fn).toContain(
      'where exists (select 1 from public.event_photos p where p.event_id = e.id)',
    );
    expect(sql).toContain('grant execute on function public.event_photo_events() to service_role');
  });
});
