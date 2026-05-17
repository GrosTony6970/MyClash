import { describe, expect, it, vi } from 'vitest';
import { CompensationController } from './compensation.controller';

describe('CompensationController auth', () => {
  it('creates plans using internal GoTrue token validation from the admin cookie', async () => {
    const createPlan = vi.fn().mockResolvedValue({ id: 'plan-1' });
    const getAuthUser = vi.fn().mockResolvedValue({ id: 'user-1' });
    const anonGetUser = vi.fn();
    const controller = new CompensationController(
      { createPlan } as never,
      { getAuthUser, anon: { auth: { getUser: anonGetUser } } } as never,
    );

    await controller.createPlan(
      '11111111-1111-4111-8111-111111111111',
      { name: 'Local referee plan', publicVisibility: false },
      { cookies: { 'sb-access-token': 'cookie-token' }, headers: {} } as never,
    );

    expect(getAuthUser).toHaveBeenCalledWith('cookie-token');
    expect(anonGetUser).not.toHaveBeenCalled();
    expect(createPlan).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Local referee plan' }),
      'user-1',
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('uses bearer tokens when present for compensation writes', async () => {
    const updatePlan = vi.fn().mockResolvedValue({ id: 'plan-1' });
    const getAuthUser = vi.fn().mockResolvedValue({ id: 'user-2' });
    const controller = new CompensationController(
      { updatePlan } as never,
      { getAuthUser, anon: { auth: { getUser: vi.fn() } } } as never,
    );

    await controller.updatePlan('22222222-2222-4222-8222-222222222222', { name: 'Updated plan' }, {
      cookies: { 'sb-access-token': 'cookie-token' },
      headers: { authorization: 'Bearer bearer-token' },
    } as never);

    expect(getAuthUser).toHaveBeenCalledWith('bearer-token');
    expect(updatePlan).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      expect.objectContaining({ name: 'Updated plan' }),
      'user-2',
    );
  });
});
