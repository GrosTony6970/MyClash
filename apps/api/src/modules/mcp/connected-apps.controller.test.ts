import { UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseService } from '../supabase/supabase.service';
import { ConnectedAppsController } from './connected-apps.controller';
import type { ConnectedAppsService } from './connected-apps.service';

function setup(user: { id: string } | null) {
  const apps = {
    list: vi.fn().mockResolvedValue({ apps: [] }),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
  const supabase = { getAuthUser: vi.fn().mockResolvedValue(user) };
  const controller = new ConnectedAppsController(
    apps as unknown as ConnectedAppsService,
    supabase as unknown as SupabaseService,
  );
  return { controller, apps, supabase };
}

function request(cookie?: string): FastifyRequest {
  return { headers: {}, cookies: cookie ? { 'sb-access-token': cookie } : {} } as never;
}

const CLIENT = '3f2b8c1e-5a4d-4e6f-9b0a-1c2d3e4f5a6b';

describe('ConnectedAppsController', () => {
  it("passes the person's browser login on once it is a live one", async () => {
    const { controller, apps, supabase } = setup({ id: 'user-1' });
    await controller.list(request('browser-login'));
    expect(supabase.getAuthUser).toHaveBeenCalledWith('browser-login');
    expect(apps.list).toHaveBeenCalledWith('browser-login');

    await controller.disconnect(CLIENT, request('browser-login'));
    expect(apps.disconnect).toHaveBeenCalledWith(CLIENT, 'browser-login');
  });

  it('answers 401 signed out, and asks GoTrue nothing', async () => {
    const { controller, apps } = setup(null);
    await expect(controller.list(request())).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.disconnect(CLIENT, request())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(apps.list).not.toHaveBeenCalled();
    expect(apps.disconnect).not.toHaveBeenCalled();
  });

  it('answers 401 for a login that no longer verifies', async () => {
    const { controller, apps } = setup(null);
    await expect(controller.list(request('ended-login'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(apps.list).not.toHaveBeenCalled();
  });
});
