import { HttpException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockSupabase as seededSupabase,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { AuthService } from './auth.service';

/**
 * The "claim my profile" search, `GET /me/global-person-search` (operator
 * ruling 105): any signed-in personal account, as the people search (ruling
 * 99). It lists UNCLAIMED profiles by a name the caller typed, so it names
 * people who have not agreed to anything:
 *   - the country shows only when the profile's privacy map allows it;
 *   - a profile that was erased, deleted or merged away is never offered;
 *   - a failed read is a 5xx, never "nobody matches".
 *
 * Until 2026-09-25 the country ignored the privacy map and erased profiles
 * were listed.
 */
const USER = { id: 'user-1', email: 'bob@example.com', user_metadata: {} };

const PROFILES = [
  {
    id: 'open',
    display_name: 'Anna Dupont',
    given_name: 'Anna',
    family_name: 'Dupont',
    country_code: 'FR',
  },
  {
    id: 'private-country',
    display_name: 'Bea Dupont',
    given_name: 'Bea',
    family_name: 'Dupont',
    country_code: 'BE',
    public_visibility: { nationality: false },
  },
  {
    id: 'erased',
    display_name: 'Chloe Dupont',
    given_name: 'Chloe',
    family_name: 'Dupont',
    account_deleted_at: '2026-09-01T00:00:00Z',
  },
  {
    id: 'deleted',
    display_name: 'Dora Dupont',
    given_name: 'Dora',
    family_name: 'Dupont',
    deleted_at: '2026-09-01T00:00:00Z',
  },
];

let supabase: { getAuthUser: ReturnType<typeof vi.fn>; service: ReturnType<typeof seededSupabase> };
let service: AuthService;

function build(table: TableSeed = { rows: PROFILES }) {
  supabase = {
    getAuthUser: vi.fn().mockResolvedValue(USER),
    service: seededSupabase({ global_persons: table }),
  };
  service = new AuthService(
    supabase as never,
    { sendMagicLink: vi.fn() } as never,
    { getOrThrow: vi.fn(), get: vi.fn((_k: string, def?: string) => def ?? '') } as never,
    {} as never,
    {} as never,
  );
}

beforeEach(() => build());

const signedIn = { headers: { authorization: 'Bearer t' }, cookies: {} } as never;

describe('GET /me/global-person-search (ruling 105)', () => {
  it('offers only reachable profiles: never an erased or deleted one', async () => {
    const rows = await service.searchGlobalPersonsForClaim(signedIn, 'Dupont');
    expect(rows.map((row) => row.id)).toEqual(['open', 'private-country']);
  });

  it("shows a country only when the profile's privacy map allows it", async () => {
    const rows = await service.searchGlobalPersonsForClaim(signedIn, 'Dupont');
    expect(rows.map((row) => [row.id, row.country_code])).toEqual([
      ['open', 'FR'],
      ['private-country', null],
    ]);
  });

  it('reads the privacy map with the row', async () => {
    await service.searchGlobalPersonsForClaim(signedIn, 'Dupont');
    expect(selectsFor(supabase.service.from, 'global_persons')[0]).toMatch(
      /\bpublic_visibility\b/u,
    );
  });

  it('still refuses a signed-out caller with a 401', async () => {
    await expect(
      service.searchGlobalPersonsForClaim({ headers: {}, cookies: {} } as never, 'Dupont'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('fails a failed read loudly (5xx), never as "nobody matches"', async () => {
    build({ data: null, error: { message: 'boom' } });
    const call = service.searchGlobalPersonsForClaim(signedIn, 'Dupont');
    await expect(call).rejects.toThrow('global person search failed: boom');
    await expect(call).rejects.not.toBeInstanceOf(HttpException);
  });
});
