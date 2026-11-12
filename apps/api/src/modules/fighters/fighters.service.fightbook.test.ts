import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { FightersService } from './fighters.service';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const LEA = '2d1e5c74-9f7b-4c79-9b77-3d3d5b7e4c03';
const REACHABLE = { deleted_at: null, merged_into_id: null, account_deleted_at: null };

function serviceFor(marc: { enabled: boolean; showStars: boolean }) {
  const supabase = mockSupabase(
    {
      global_persons: {
        rows: [
          {
            id: MARC,
            slug: 'marc-test',
            display_name: 'Marc Test',
            ...REACHABLE,
            // The double hands the whole row back whatever the projection says: a switch that
            // reaches the answer would show up here.
            fightbook_enabled: marc.enabled,
            fightbook_show_stars: marc.showStars,
          },
          { id: LEA, slug: 'lea-test', display_name: 'Lea Test', ...REACHABLE },
        ],
      },
      spar_requests: { rows: [] },
    },
    { fightbook_star_line: () => ({ data: { average: 4.2, count: 5 }, error: null }) },
  );
  const service = new FightersService(supabase as never, undefined as never);
  // The relations and the hidden-profile check have their own reads and tests.
  const seams = service as unknown as {
    isHiddenProfile(id: string): Promise<boolean>;
    withPublicProfileRelations(profile: unknown): Promise<unknown>;
  };
  vi.spyOn(seams, 'isHiddenProfile').mockResolvedValue(false);
  vi.spyOn(seams, 'withPublicProfileRelations').mockImplementation(async (profile) => profile);
  return service;
}

describe('FightersService.getBySlug and the FightBook line', () => {
  it('carries the line, and neither FightBook switch as a key', async () => {
    const result = await serviceFor({ enabled: true, showStars: true }).getBySlug('marc-test');
    expect(result.fightbook).toEqual({ sparred: 0, stars: { average: 4.2, count: 5 } });
    expect(result).not.toHaveProperty('fightbook_enabled');
    expect(result).not.toHaveProperty('fightbook_show_stars');
    expect(Object.keys(result.fightbook ?? {}).sort()).toEqual(['sparred', 'stars']);
  });

  it('answers a null line with FightBook off', async () => {
    const result = await serviceFor({ enabled: false, showStars: true }).getBySlug('marc-test');
    expect(result.fightbook).toBeNull();
    expect(result).not.toHaveProperty('fightbook_enabled');
    expect(result).not.toHaveProperty('fightbook_show_stars');
  });
});
