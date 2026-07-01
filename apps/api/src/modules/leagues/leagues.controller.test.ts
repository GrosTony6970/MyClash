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
