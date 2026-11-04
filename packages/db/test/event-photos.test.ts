/**
 * Event photos (migration 0249): the Event's photo mode and token version, the deny-all photo
 * table, and the counting function the upload checks before it reads a file. Read from the
 * migrations as one text, so a later migration that drops one of these reds here. The running
 * database is `pnpm db:rls-probe`'s.
 */
import { describe, expect, it } from 'vitest';
import { allSql, flat, functionStatement } from './migration-sql';

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
