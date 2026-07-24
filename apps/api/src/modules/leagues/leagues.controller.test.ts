import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { LeaguesController } from './leagues.controller';

describe('LeaguesController auth', () => {
  it('creates leagues using internal GoTrue token validation from the admin cookie', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'league-1' });
    const getAuthUser = vi.fn().mockResolvedValue({ id: 'user-1' });
    const anonGetUser = vi.fn();
    const controller = new LeaguesController(
      { create } as never,
      { getAuthUser, anon: { auth: { getUser: anonGetUser } } } as never,
    );

    await controller.create(
      {
        name: 'French National League',
        slug: 'french-national-league',
        seasonYear: 2026,
      },
      { cookies: { 'sb-access-token': 'cookie-token' }, headers: {} } as never,
    );

    expect(getAuthUser).toHaveBeenCalledWith('cookie-token');
    expect(anonGetUser).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'french-national-league' }),
      'user-1',
    );
  });

  it('uses bearer tokens before admin cookies for league updates', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'league-1' });
    const getAuthUser = vi.fn().mockResolvedValue({ id: 'user-2' });
    const controller = new LeaguesController(
      { update } as never,
      { getAuthUser, anon: { auth: { getUser: vi.fn() } } } as never,
    );

    await controller.update('22222222-2222-4222-8222-222222222222', { name: 'Updated league' }, {
      cookies: { 'sb-access-token': 'cookie-token' },
      headers: { authorization: 'Bearer bearer-token' },
    } as never);

    expect(getAuthUser).toHaveBeenCalledWith('bearer-token');
    expect(update).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      expect.objectContaining({ name: 'Updated league' }),
      'user-2',
    );
  });

  it('lists org league-memberships, resolving the caller from the admin cookie', async () => {
    const listOrganizationMemberships = vi.fn().mockResolvedValue([{ id: 'league-1' }]);
    const getAuthUser = vi.fn().mockResolvedValue({ id: 'user-3' });
    const controller = new LeaguesController(
      { listOrganizationMemberships } as never,
      { getAuthUser, anon: { auth: { getUser: vi.fn() } } } as never,
    );

    await controller.listOrganizationMemberships('33333333-3333-4333-8333-333333333333', {
      cookies: { 'sb-access-token': 'cookie-token' },
      headers: {},
    } as never);

    expect(getAuthUser).toHaveBeenCalledWith('cookie-token');
    expect(listOrganizationMemberships).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
      'user-3',
    );
  });

  it('serves public club standings without requiring auth', async () => {
    const clubStandings = vi.fn().mockResolvedValue({ clubs: [], unaffiliated: null });
    const getAuthUser = vi.fn();
    const controller = new LeaguesController(
      { clubStandings } as never,
      { getAuthUser, anon: { auth: { getUser: vi.fn() } } } as never,
    );

    await controller.clubStandings('44444444-4444-4444-8444-444444444444', { group: 'longsword' });

    expect(getAuthUser).not.toHaveBeenCalled();
    expect(clubStandings).toHaveBeenCalledWith('44444444-4444-4444-8444-444444444444', 'longsword');
  });

  it('resolves the caller from the admin cookie for admin club standings', async () => {
    const adminClubStandings = vi.fn().mockResolvedValue({ clubs: [], unaffiliated: null });
    const getAuthUser = vi.fn().mockResolvedValue({ id: 'user-5' });
    const controller = new LeaguesController(
      { adminClubStandings } as never,
      { getAuthUser, anon: { auth: { getUser: vi.fn() } } } as never,
    );

    await controller.adminClubStandings('55555555-5555-4555-8555-555555555555', {}, {
      cookies: { 'sb-access-token': 'cookie-token' },
      headers: {},
    } as never);

    expect(getAuthUser).toHaveBeenCalledWith('cookie-token');
    expect(adminClubStandings).toHaveBeenCalledWith(
      '55555555-5555-4555-8555-555555555555',
      'user-5',
      undefined,
    );
  });

  it('clones a league into a new season, resolving the caller from the admin cookie', async () => {
    const clone = vi.fn().mockResolvedValue({ id: 'new-league' });
    const getAuthUser = vi.fn().mockResolvedValue({ id: 'user-6' });
    const controller = new LeaguesController(
      { clone } as never,
      { getAuthUser, anon: { auth: { getUser: vi.fn() } } } as never,
    );

    await controller.cloneLeague('66666666-6666-4666-8666-666666666666', { seasonYear: 2027 }, {
      cookies: { 'sb-access-token': 'cookie-token' },
      headers: {},
    } as never);

    expect(getAuthUser).toHaveBeenCalledWith('cookie-token');
    expect(clone).toHaveBeenCalledWith(
      '66666666-6666-4666-8666-666666666666',
      { seasonYear: 2027 },
      'user-6',
    );
  });

  it('finalizes and reopens a league season', async () => {
    const finalize = vi.fn().mockResolvedValue({ id: 'L1', finalized_at: 'now' });
    const reopen = vi.fn().mockResolvedValue({ id: 'L1', finalized_at: null });
    const getAuthUser = vi.fn().mockResolvedValue({ id: 'user-7' });
    const controller = new LeaguesController(
      { finalize, reopen } as never,
      { getAuthUser, anon: { auth: { getUser: vi.fn() } } } as never,
    );
    const req = { cookies: { 'sb-access-token': 'cookie-token' }, headers: {} } as never;

    await controller.finalizeLeague('77777777-7777-4777-8777-777777777777', req);
    await controller.reopenLeague('77777777-7777-4777-8777-777777777777', req);

    expect(finalize).toHaveBeenCalledWith('77777777-7777-4777-8777-777777777777', 'user-7');
    expect(reopen).toHaveBeenCalledWith('77777777-7777-4777-8777-777777777777', 'user-7');
  });

  it('rejects invalid tokens instead of passing anonymous to league mutations', async () => {
    const create = vi.fn();
    const controller = new LeaguesController(
      { create } as never,
      {
        getAuthUser: vi.fn().mockResolvedValue(null),
        anon: { auth: { getUser: vi.fn() } },
      } as never,
    );

    await expect(
      controller.create(
        {
          name: 'French National League',
          slug: 'french-national-league',
          seasonYear: 2026,
        },
        { cookies: { 'sb-access-token': 'bad-token' }, headers: {} } as never,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(create).not.toHaveBeenCalled();
  });
});
