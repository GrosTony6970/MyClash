import { describe, expect, it } from 'vitest';
import { StaffService } from './staff.service';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';

/**
 * `GET /staff-auth/events` is a `@Public()` route that lists events.
 *
 * Two things stand between it and a bulk read of every draft event on the
 * platform, and both are tested here rather than assumed:
 *
 *   1. The row filter — only events with at least one ACTIVE staff account.
 *   2. The projection — six fields, built by hand, never spread from the row.
 *
 * The projection test matters more than it looks. `GET /events` selects `*`
 * (events.service.ts), so a row from that table carries the organisation's AI
 * spend cap, the creating user's id and unpublished landing copy. Returning
 * `{ ...row }` here would ship all of it to anyone who can reach the login
 * page, and nothing else in the stack would object.
 */

/** One `events` row as PostgREST returns it for the picker's select. */
function eventRow(over: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    slug: 'fal-2026',
    name: 'FAL 2026',
    start_date: '2026-08-08',
    status: 'running',
    event_kind: 'standard',
    // The inner embed comes back as an array — event_staff_accounts.event_id is
    // not unique, so PostgREST does NOT flip it to an object.
    event_staff_accounts: [{ id: 'staff-1' }],
    // The flat key the embedded filter reads. A seeded row answers
    // `.eq('event_staff_accounts.status', …)` from this, not from the nested
    // array above — PostgREST resolves the embed server-side, so there is
    // nothing here to walk.
    'event_staff_accounts.status': 'active',
    ...over,
  };
}

/**
 * Seeded, not canned: the picker read ends
 * `.order('start_date', { ascending: true, nullsFirst: false })`, and a draft
 * with no date typed yet is exactly the event most likely to need a test
 * sign-in. That combination is why the double learned where nulls sort.
 *
 * Rows carry the embedded filter's key flat — `'event_staff_accounts.status'` —
 * because that is how a dotted filter reaches a seeded row.
 */
function serviceFor(rows: Array<Record<string, unknown>>) {
  const supabase = mockSupabase({ events: { rows } });
  return {
    service: new StaffService(supabase as never, {} as never, {} as never, {} as never),
    from: supabase.from,
  };
}

describe('StaffService.listPickerEvents', () => {
  it('returns ONLY the six picker fields, dropping everything else on the row', async () => {
    // A realistic `events` row carries far more than the picker needs. These
    // three are the ones that would actually hurt: an org's spend cap, the
    // creating user's id, and landing copy for an unpublished event.
    const { service } = serviceFor([
      eventRow({
        ai_spend_cap_eur: 250,
        created_by_user_id: 'user-secret',
        public_landing_md: '# not published yet',
        organization_id: 'org-1',
      }),
    ]);

    const [picked] = await service.listPickerEvents();

    expect(Object.keys(picked ?? {}).sort()).toEqual([
      'id',
      'kind',
      'name',
      'slug',
      'startDate',
      'status',
    ]);
    // Named explicitly as well as by key-set, so a future field added to the
    // interface cannot quietly re-admit one of these.
    expect(JSON.stringify(picked)).not.toMatch(/user-secret|not published yet|250|org-1/);
  });

  it('requires an ACTIVE staff account on the event, via an inner embed', async () => {
    // An event whose only staff accounts are DISABLED is a door nobody holds a
    // key to. It is dropped by the filter on the embedded table, not by the
    // `!inner` — which only drops events with no staff rows at all.
    const { service, from } = serviceFor([
      eventRow({ id: 'e-open' }),
      eventRow({ id: 'e-all-disabled', 'event_staff_accounts.status': 'disabled' }),
    ]);

    const rows = await service.listPickerEvents();

    expect(rows.map((r) => r.id)).toEqual(['e-open']);
    // The projection is asserted separately because the double ignores it: the
    // embed has to be `!inner`, or an event with no staff rows survives.
    expect(selectsFor(from, 'events')[0]).toContain('event_staff_accounts!inner');
  });

  it('offers only statuses a staff session can actually be created for', async () => {
    // `assertEventScorable` refuses completed and archived, so listing one
    // would offer a door that cannot open — the volunteer taps it, types their
    // PIN, and gets a 403 with no explanation of which part was wrong.
    const { service } = serviceFor([
      eventRow({ id: 'e-running', status: 'running' }),
      eventRow({ id: 'e-done', status: 'completed' }),
      eventRow({ id: 'e-archived', status: 'archived' }),
    ]);

    const rows = await service.listPickerEvents();

    expect(rows.map((r) => r.id)).toEqual(['e-running']);
  });

  it('keeps test, club and draft events reachable', async () => {
    // The whole reason this endpoint exists instead of a flag on GET /events:
    // that route hard-excludes test events and defaults away from drafts, both
    // correct for spectators and both wrong for a volunteer who has been handed
    // a tablet for a dry run.
    const { service } = serviceFor([
      eventRow({ id: 'e-test', event_kind: 'test', status: 'draft' }),
      eventRow({ id: 'e-club', event_kind: 'club', status: 'published' }),
    ]);

    const rows = await service.listPickerEvents();

    expect(rows.map((r) => r.kind)).toEqual(['test', 'club']);
    // Carried so the picker can BADGE them. A volunteer signing into the wrong
    // one should find out on the login screen, not after checking in ten
    // fighters to a dry run.
    expect(rows.map((r) => r.status)).toEqual(['draft', 'published']);
  });

  it('tolerates an event with no start date rather than dropping it', async () => {
    // A draft with the date not yet typed is precisely the event most likely to
    // need a test sign-in.
    const { service } = serviceFor([eventRow({ start_date: null })]);

    const [picked] = await service.listPickerEvents();

    expect(picked?.startDate).toBeNull();
  });
});
