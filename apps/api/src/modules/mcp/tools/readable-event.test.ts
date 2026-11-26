import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { readableEventBySlug } from './readable-event';

const SELECT =
  'id, name, slug, start_date, end_date, status, timezone, organization_id, event_kind';
const caller = { userId: 'user-1', email: 'a@b.c', clientId: 'claude-client' };

const row = (over: Record<string, unknown> = {}) => ({
  id: 'event-uuid',
  name: 'FAL 2026',
  slug: 'fal-2026',
  start_date: '2026-03-14',
  end_date: '2026-03-15',
  status: 'published',
  timezone: 'Europe/Paris',
  organization_id: 'org-uuid',
  event_kind: 'standard',
  ...over,
});

function deps(result: { data: unknown; error: { message: string } | null }, member = false) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  const assertOrgRole = vi.fn(async () => {
    if (!member) throw new ForbiddenException();
  });
  return {
    from,
    select,
    eq,
    assertOrgRole,
    deps: { supabase: { service: { from } }, orgs: { assertOrgRole } } as never,
  };
}

describe('readableEventBySlug', () => {
  it('answers the Event as a tool sees it, reading one row by slug', async () => {
    const d = deps({ data: row(), error: null });
    expect(await readableEventBySlug('fal-2026', caller, d.deps)).toEqual({
      id: 'event-uuid',
      name: 'FAL 2026',
      slug: 'fal-2026',
      startDate: '2026-03-14',
      endDate: '2026-03-15',
      status: 'published',
      timezone: 'Europe/Paris',
    });
    expect(d.from).toHaveBeenCalledWith('events');
    expect(d.select).toHaveBeenCalledWith(SELECT);
    expect(d.eq).toHaveBeenCalledWith('slug', 'fal-2026');
  });

  it('answers null for an unknown slug', async () => {
    const d = deps({ data: null, error: null });
    expect(await readableEventBySlug('nope', caller, d.deps)).toBeNull();
  });

  it('answers null for a draft Event the person is not a member of', async () => {
    const d = deps({ data: row({ status: 'draft' }), error: null });
    expect(await readableEventBySlug('fal-2026', caller, d.deps)).toBeNull();
    expect(d.assertOrgRole).toHaveBeenCalledWith('org-uuid', 'user-1', 'read_only');
  });

  it('answers the draft Event to a member of its club', async () => {
    const d = deps({ data: row({ status: 'draft' }), error: null }, true);
    expect((await readableEventBySlug('fal-2026', caller, d.deps))?.slug).toBe('fal-2026');
  });

  it('throws on a failed read: it is not an unknown Event', async () => {
    const d = deps({ data: null, error: { message: 'boom' } });
    await expect(readableEventBySlug('fal-2026', caller, d.deps)).rejects.toThrow(
      'event read failed: boom',
    );
  });
});
