import { describe, expect, it } from 'vitest';
import { StaffService } from './staff.service';
import { mockSupabase, selectsFor, type SupabaseRow } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { ANON, LICE, at, displayRow, serviceOn } from './staff.service.display.fixtures';

/**
 * The NEXT tile names the next bout's fighters, and the rollover opens it. A
 * projector with no login must not be handed a bout of an unpublished
 * Tournament (rulings 82, 89); a laptop signed in as a club member is. What is
 * public is decided before the query keeps its first eight bouts: organisers
 * schedule a Tournament before they publish it.
 */
describe('StaffService.getPublicMatchDisplay: the next bout a projector may see', () => {
  const inDraftTournament = (row: SupabaseRow): SupabaseRow => {
    const phases = row['phases'] as { tournaments: SupabaseRow };
    return {
      ...row,
      phases: { tournaments: { ...phases.tournaments, status: 'draft' } },
      'phases.tournaments.status': 'draft',
    };
  };
  const ROWS: SupabaseRow[] = [
    displayRow('current', { lice_id: LICE, status: 'running', scheduled_at: at(9) }),
    ...Array.from({ length: 8 }, (_, i) =>
      inDraftTournament(
        displayRow(`hidden-${i}`, {
          lice_id: LICE,
          status: 'scheduled',
          scheduled_at: at(10 + i),
        }),
      ),
    ),
    displayRow('public-next', { lice_id: LICE, status: 'scheduled', scheduled_at: at(20) }),
  ];

  function signedInService() {
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
    const service = new StaffService(supabase as never, orgs, {} as never, {} as never);
    return { service, from: supabase.from };
  }

  it('names the next public bout to a projector, past eight hidden ones', async () => {
    const payload = (await serviceOn(ROWS).service.getPublicMatchDisplay('current', ANON)) as {
      nextMatchId: string | null;
      nextMatch: { id: string } | null;
    };

    expect(payload.nextMatchId).toBe('public-next');
    expect(payload.nextMatch?.id).toBe('public-next');
  });

  it('names the hidden bout to a club member, and not to a stranger', async () => {
    const member = (await signedInService().service.getPublicMatchDisplay('current', {
      userId: 'u-member',
      staff: null,
    })) as { nextMatchId: string | null };
    const stranger = (await signedInService().service.getPublicMatchDisplay('current', {
      userId: 'u-stranger',
      staff: null,
    })) as { nextMatchId: string | null };

    expect(member.nextMatchId).toBe('hidden-0');
    expect(stranger.nextMatchId).toBe('public-next');
  });

  it('reads the columns it decides on', async () => {
    const { service, from } = signedInService();
    await service.getPublicMatchDisplay('current', { userId: 'u-member', staff: null });

    // The double hands back the whole row whatever is selected, and PostgREST
    // filters bouts through an embed only when every embed on the path is inner.
    const next = selectsFor(from, 'matches').find((select) => select.startsWith('id,status,'));
    expect(next).toContain('phases!inner(');
    expect(next).toMatch(/tournaments!inner\([^)]*\bstatus\b/);
    expect(selectsFor(from, 'lices')).toEqual(['events!inner(id, organization_id)']);
  });
});
