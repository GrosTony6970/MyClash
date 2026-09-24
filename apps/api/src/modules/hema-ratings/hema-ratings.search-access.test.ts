/**
 * Who may use the HEMA Ratings suggest box, `GET /hema-ratings/search` (operator
 * ruling 100): an `editor` or above in any organization — the bar for adding a
 * person to an Event, which is where the box sits. A signed-out caller gets a
 * 401; a competitor account with no club, a role below `editor`, an Event staff
 * login and a guest token get a 403.
 *
 * With the `disable_hema_sync` kill switch on, the search still answers from the
 * stored snapshot, but it makes NO call to hemaratings.com and NO snapshot write.
 *
 * Until 2026-09-24 anyone could search, and each search could fetch missing
 * nationalities from hemaratings.com and rewrite the snapshot, switch or not.
 */
import { ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  mockSupabase,
  queriedTables,
  selectsFor,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { HemaRatingsController } from './hema-ratings.controller';
import { HemaRatingsService } from './hema-ratings.service';

const EDITOR = '11111111-1111-4111-8111-111111111111';
const LEAD = '22222222-2222-4222-8222-222222222222';
const COMPETITOR = '33333333-3333-4333-8333-333333333333';

const MEMBERS: TableSeed = {
  rows: [
    // The role just below the bar, in an organization of its own.
    { organization_id: 'org-a', user_id: LEAD, role: 'workshop_lead' },
    { organization_id: 'org-b', user_id: EDITOR, role: 'editor' },
  ],
};

const claimed = (userId: string) => ({ identity: { kind: 'claimed', userId, email: null } });
const QUERY = { q: 'Dupont' };

describe('GET /hema-ratings/search (ruling 100): who may search', () => {
  let db: ReturnType<typeof mockSupabase>;
  let search: Mock;
  let controller: HemaRatingsController;

  beforeEach(() => {
    db = mockSupabase({ organization_members: MEMBERS });
    search = vi.fn().mockResolvedValue([]);
    const supabase = { service: db.service };
    controller = new HemaRatingsController(
      { search } as never,
      supabase as never,
      new OrganizationsService(supabase as never),
    );
  });

  const ask = (req: unknown) => controller.search(QUERY as never, req as never);

  it('lets an editor of any organization search', async () => {
    await ask(claimed(EDITOR));
    expect(search).toHaveBeenCalledWith('Dupont', 5);
  });

  it.each([
    ['a role below editor', LEAD],
    ['a competitor account with no organization', COMPETITOR],
  ])('refuses %s with a 403, before searching', async (_label, userId) => {
    await expect(ask(claimed(userId))).rejects.toThrow(ForbiddenException);
    expect(search).not.toHaveBeenCalled();
  });

  it('refuses a signed-out caller with a 401, and reads nothing', async () => {
    await expect(ask({ identity: { kind: 'anonymous' } })).rejects.toThrow(UnauthorizedException);
    expect(queriedTables(db.from)).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it.each([
    ['an Event staff login', { identity: { kind: 'staff', staffId: 's-1', eventId: 'e-1' } }],
    [
      'a guest token',
      { identity: { kind: 'guest', guestSessionId: 'g-1', personId: 'p-1', eventId: 'e-1' } },
    ],
  ])('refuses %s, which has no user id, before any read', async (_label, req) => {
    await expect(ask(req)).rejects.toThrow(ForbiddenException);
    expect(queriedTables(db.from)).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it('reads only the role column of the memberships', async () => {
    await ask(claimed(EDITOR));
    expect(selectsFor(db.from, 'organization_members')).toEqual(['role']);
  });
});

describe('GET /hema-ratings/search (ruling 100): the kill switch', () => {
  const SNAPSHOT = {
    rows: [
      {
        id: 'snap-1',
        synced_at: '2026-09-01T00:00:00Z',
        fighters: [
          { id: 101, name: 'Jean Dupont', club: 'Lyon AMHE', nationality: 'France' },
          // No nationality stored: the one a search would fetch upstream.
          { id: 102, name: 'Marie Dupont', club: 'Lyon AMHE' },
        ],
      },
    ],
  };
  // Marie's detail page, so a search that goes upstream succeeds and writes back.
  const MARIE_PAGE = `
    <h1>Marie Dupont</h1>
    <table><tbody>
      <tr><td>Club</td><td>Lyon AMHE</td></tr>
      <tr><td>Nationality</td><td>Belgium</td></tr>
    </tbody></table>`;
  let fetchSpy: Mock;

  beforeEach(() => {
    fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve(MARIE_PAGE) });
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  function service(flagOn: boolean, snapshot: TableSeed = SNAPSHOT) {
    const db = mockSupabase({
      hema_ratings_snapshots: snapshot,
      feature_flags: { rows: [{ key: 'disable_hema_sync', enabled: flagOn }] },
    });
    return { db, hema: new HemaRatingsService({ service: db.service } as never) };
  }

  it('answers from the snapshot with no upstream call and no snapshot write while it is on', async () => {
    const { db, hema } = service(true);
    const results = await hema.search('Dupont', 5);
    expect(results.map((r) => [r.name, r.nationality])).toEqual([
      ['Jean Dupont', 'France'],
      ['Marie Dupont', null],
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(writesTo(db, 'hema_ratings_snapshots')).toEqual([]);
  });

  it('fetches a missing nationality upstream and writes it back while it is off', async () => {
    const { db, hema } = service(false);
    const results = await hema.search('Dupont', 5);
    expect(results.map((r) => [r.name, r.nationality])).toEqual([
      ['Jean Dupont', 'France'],
      ['Marie Dupont', 'Belgium'],
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(writesTo(db, 'hema_ratings_snapshots')).toHaveLength(1);
  });

  it('reads no switch when every match already carries its nationality', async () => {
    const { db, hema } = service(true);
    await hema.search('Jean', 5);
    expect(queriedTables(db.from)).toEqual(['hema_ratings_snapshots']);
  });

  it('fails a failed snapshot read loudly (5xx), never as "no match"', async () => {
    const { hema } = service(true, { data: null, error: { message: 'boom' } });
    const call = hema.search('Dupont', 5);
    await expect(call).rejects.toThrow('HEMA Ratings snapshot read failed: boom');
    await expect(call).rejects.not.toBeInstanceOf(HttpException);
  });
});
