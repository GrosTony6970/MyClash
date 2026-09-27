import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CompensationController } from './compensation.controller';

const ORG = '11111111-1111-4111-8111-111111111111';
const PLAN = '22222222-2222-4222-8222-222222222222';
const EVENT = '33333333-3333-4333-8333-333333333333';
const PERSON = '44444444-4444-4444-8444-444444444444';

/** Every write, called with `req`: none may reach the service without a login. */
const WRITES = [
  {
    name: 'createPlan',
    call: (c: CompensationController, r: never) => c.createPlan(ORG, { name: 'Plan' }, r),
  },
  { name: 'updatePlan', call: (c: CompensationController, r: never) => c.updatePlan(PLAN, {}, r) },
  { name: 'deletePlan', call: (c: CompensationController, r: never) => c.deletePlan(PLAN, r) },
  {
    name: 'upsertRoleRates',
    call: (c: CompensationController, r: never) => c.upsertRoleRates(PLAN, { rates: [] }, r),
  },
  {
    name: 'upsertTiers',
    call: (c: CompensationController, r: never) => c.upsertTiers(PLAN, { tiers: [] }, r),
  },
  {
    name: 'upsertEventSettings',
    call: (c: CompensationController, r: never) =>
      c.upsertEventSettings(EVENT, { planId: null } as never, r),
  },
  {
    name: 'togglePaid',
    call: (c: CompensationController, r: never) => c.togglePaid(EVENT, PERSON, { paid: true }, r),
  },
];

describe('CompensationController writes without a valid login (ruling 154)', () => {
  // Organiser Marie's login runs out over lunch; her next save must answer 401,
  // the one status on which the web client renews the login and sends it again.
  // The writes used to hand 'anonymous' to the service, which refused it 403.
  function controllerWith(service: Record<string, unknown>) {
    const getAuthUser = vi.fn(async (token: string) => (token === 'fresh' ? { id: 'u-1' } : null));
    return new CompensationController(service as never, { getAuthUser } as never);
  }

  it.each(WRITES)('$name answers 401 with no token, before the service', async (write) => {
    const called = vi.fn();
    const controller = controllerWith(new Proxy({}, { get: () => called }));
    const none = { headers: {}, cookies: {} } as never;
    await expect(write.call(controller, none)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(write.call(controller, none)).rejects.toThrow(/^Authentication required$/);
    expect(called).not.toHaveBeenCalled();
  });

  it.each(WRITES)('$name answers 401 with an expired token, before the service', async (write) => {
    const called = vi.fn();
    const controller = controllerWith(new Proxy({}, { get: () => called }));
    const expired = { headers: {}, cookies: { 'sb-access-token': 'expired' } } as never;
    await expect(write.call(controller, expired)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(write.call(controller, expired)).rejects.toThrow(/^Invalid or expired session$/);
    expect(called).not.toHaveBeenCalled();
  });

  it.each(WRITES)('$name hands its own service method the signed-in user id', async (write) => {
    const called = vi.fn().mockResolvedValue({});
    const reached: string[] = [];
    const service = new Proxy({}, { get: (_, method) => (reached.push(String(method)), called) });
    const controller = controllerWith(service);
    await write.call(controller, { headers: {}, cookies: { 'sb-access-token': 'fresh' } } as never);
    // Each write's service method carries the handler's own name.
    expect(reached).toEqual([write.name]);
    expect(called).toHaveBeenCalledTimes(1);
    expect(called.mock.calls[0]).toContain('u-1');
  });
});

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
