import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { StaffService } from './staff.service';
import { mockSupabase, selectsFor, type SupabaseRow } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { ANON, LICE, at } from './staff.service.display.fixtures';

/**
 * The pad's prev/next tiles name the fighters of the bouts either side of this
 * one on its piste. The route is public, so a bout of an unpublished Tournament
 * is skipped for an outsider — the tile shows the nearest public bout — and kept
 * for a club member or the Event's own staff (rulings 82, 83).
 */
describe('StaffService.getMatchNeighbors: what an outsider may see', () => {
  const bout = (id: string, hour: number, tournamentStatus: string): SupabaseRow => ({
    id,
    lice_id: LICE,
    status: 'scheduled',
    scheduled_at: at(hour),
    match_number_label: id,
    red: { persons: { given_name: 'Red', family_name: id } },
    blue: { persons: { given_name: 'Blue', family_name: id } },
    phases: { config_json: null, tournaments: { weapon: 'longsword', status: tournamentStatus } },
    // The flat key a dotted filter reads on a seeded row (`onlyPublicTournaments`).
    'phases.tournaments.status': tournamentStatus,
    pools: { sort_order: 0 },
    bracket_slots: null,
  });
  const ROWS = [
    bout('before', 10, 'published'),
    bout('hidden', 11, 'draft'),
    bout('current', 12, 'running'),
    bout('after', 14, 'completed'),
  ];

  function service() {
    const supabase = mockSupabase({
      matches: { rows: ROWS },
      lices: {
        rows: [
          { id: LICE, event_id: 'event-1', events: { id: 'event-1', organization_id: 'org-1' } },
        ],
      },
      organization_members: {
        rows: [{ organization_id: 'org-1', user_id: 'u-member', role: 'read_only' }],
      },
      event_staff_accounts: { rows: [] },
    });
    const orgs = new OrganizationsService(supabase as never);
    return {
      staff: new StaffService(supabase as never, orgs, {} as never, {} as never),
      from: supabase.from,
    };
  }
  const ids = (tiles: { previous: { id: string } | null; next: { id: string } | null }) => [
    tiles.previous?.id ?? null,
    tiles.next?.id ?? null,
  ];

  it('skips a hidden bout for a caller with no login, and for a stranger', async () => {
    for (const reader of [ANON, { userId: 'u-stranger', staff: null }]) {
      expect(ids(await service().staff.getMatchNeighbors('current', reader))).toEqual([
        'before',
        'after',
      ]);
    }
  });

  it('keeps it for a club member', async () => {
    const member = { userId: 'u-member', staff: null };
    expect(ids(await service().staff.getMatchNeighbors('current', member))).toEqual([
      'hidden',
      'after',
    ]);
  });

  // The route answers a hidden bout with its own 404; it must be word for word
  // the one this service gives an unknown bout, or the difference names a draft.
  it('answers an unknown bout exactly as the route answers a hidden one', async () => {
    const refusal = await service()
      .staff.getMatchNeighbors('nowhere', ANON)
      .catch((error: unknown) => (error as NotFoundException).getResponse());
    expect(refusal).toEqual(new NotFoundException('Match not found').getResponse());
  });

  it('reads the Tournament status through inner embeds', async () => {
    const { staff, from } = service();
    await staff.getMatchNeighbors('current', ANON);

    // The double hands back the whole row whatever is selected, and PostgREST
    // filters bouts through an embed only when every embed on the path is inner.
    const list = selectsFor(from, 'matches').find((select) => select.startsWith('id,status,'));
    expect(list).toContain('phases!inner(');
    expect(list).toMatch(/tournaments!inner\([^)]*\bstatus\b/);
  });
});
