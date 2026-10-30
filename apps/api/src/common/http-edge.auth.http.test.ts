import { Logger } from '@nestjs/common';
import { ADMIN_LOCKDOWN_CODE, READ_ONLY_MODE_CODE } from '@myclash/types';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  buildEdgeApp,
  CLASS_GUARD_MARKER,
  type EdgeApp,
  type EdgeAppOptions,
  LOGIN_MARKER,
  MarkerRefuser,
  rawRequest,
} from './testing/http-edge-app';

/**
 * Who gets through at the API edge: the global AuthGuard in both of its modes, a guard set on a
 * whole controller, the login cookie, and the read-only switch and the maintenance lockdown (two
 * global interceptors).
 *
 * Production runs AuthGuard in shadow mode (`.env.example`, `AUTH_GUARD_MODE=shadow`): it lets an
 * anonymous request through and logs it, and the guard on the controller (PlatformRoleGuard on
 * the admin pages) is what refuses. Both modes are pinned here, on the app `configureHttpApp`
 * builds, so a framework update that stops running a guard turns this file red.
 *
 * The "case N" names number the edge answers across this file and `http-edge.http.test.ts`, so a
 * commit that changes one can name it.
 */

const loginCookie = (value: string) => ({ cookie: `sb-access-token=${value}` });

async function detailOf(res: Response): Promise<unknown> {
  return ((await res.json()) as { detail?: unknown }).detail;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AuthGuard in enforce mode', () => {
  let edge: EdgeApp;
  beforeAll(async () => {
    edge = await buildEdgeApp({ authMode: 'enforce' });
  });
  afterAll(async () => {
    await edge?.app.close();
  });

  it('case 9: refuses an anonymous caller before the controller’s own guard runs', async () => {
    const res = await fetch(`${edge.base}/api/v1/class-guarded/read`);
    expect(res.status).toBe(401);
    expect(await detailOf(res)).toBe('Authentication required');
  });

  it('case 9: a signed-in caller gets past it to the controller’s own guard', async () => {
    const res = await fetch(`${edge.base}/api/v1/class-guarded/read`, {
      headers: loginCookie(LOGIN_MARKER),
    });
    expect(res.status).toBe(401);
    expect(await detailOf(res)).toBe(CLASS_GUARD_MARKER);
  });

  it('case 9: the login cookie opens a route that needs a login, and only a valid one', async () => {
    const signedIn = await fetch(`${edge.base}/api/v1/edge/signed-in`, {
      headers: loginCookie(LOGIN_MARKER),
    });
    expect(signedIn.status).toBe(200);
    expect(await signedIn.json()).toEqual({ ok: 'probe-marker-signed-in' });
    const forged = await fetch(`${edge.base}/api/v1/edge/signed-in`, {
      headers: loginCookie('probe-marker-not-a-login'),
    });
    expect(forged.status).toBe(401);
  });

  it('case 9: @Public() lets an anonymous caller through, on a route and on a controller', async () => {
    const route = await fetch(`${edge.base}/api/v1/edge/public`);
    expect(route.status).toBe(200);
    expect(await route.json()).toEqual({ ok: 'probe-marker-public' });
    const controller = await fetch(`${edge.base}/api/v1/class-public/read`);
    expect(controller.status).toBe(200);
    expect(await controller.json()).toEqual({ ok: 'probe-marker-class-public' });
  });
});

describe('AuthGuard in shadow mode (production’s)', () => {
  let edge: EdgeApp;
  const options: EdgeAppOptions = { authMode: 'shadow', readOnly: false };
  beforeAll(async () => {
    edge = await buildEdgeApp(options);
  });
  afterAll(async () => {
    await edge?.app.close();
  });

  it('case 9s: lets an anonymous caller through, logs it, and the controller’s guard refuses', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const res = await fetch(`${edge.base}/api/v1/class-guarded/read`);
    expect(res.status).toBe(401);
    expect(await detailOf(res)).toBe(CLASS_GUARD_MARKER);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('auth-shadow would-401 GET'));
  });

  it.each([
    [
      'an absolute-form target',
      (port: number) => `http://127.0.0.1:${port}/api/v1/class-guarded/read`,
    ],
    ['a percent-encoded letter', () => '/api/v1/cl%61ss-guarded/read'],
  ])('case 10: %s still meets the controller’s guard', async (_name, target) => {
    const res = await rawRequest(edge.port, 'GET', target(edge.port));
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body)).toMatchObject({ detail: CLASS_GUARD_MARKER });
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('case 10: a HEAD request meets the controller’s guard too (no body to read)', async () => {
    const refuse = vi.spyOn(MarkerRefuser.prototype, 'canActivate');
    const res = await rawRequest(edge.port, 'HEAD', '/api/v1/class-guarded/read');
    expect(res.status).toBe(401);
    expect(res.body).toBe('');
    expect(refuse).toHaveBeenCalledTimes(1);
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('case 10: a trailing slash finds no route; a double slash finds none either', async () => {
    const slash = await rawRequest(edge.port, 'GET', '/api/v1/class-guarded/read/');
    expect(slash.status).toBe(404);
    expect(slash.headers['x-request-id']).toEqual(expect.any(String));
    const double = await rawRequest(edge.port, 'GET', '//api/v1/class-guarded/read');
    expect(double.status).toBe(404);
  });

  it('case 13: the cookie plugin reads a cookie sent, and sets one with the session attributes', async () => {
    const read = await fetch(`${edge.base}/api/v1/edge/cookie`, {
      headers: { cookie: 'probe-marker-cookie=probe-marker-cookie-value' },
    });
    expect(await read.json()).toEqual({ value: 'probe-marker-cookie-value' });
    const set = await fetch(`${edge.base}/api/v1/edge/set-cookie`, { method: 'POST' });
    const cookie = set.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('probe-marker-session=probe-marker-value');
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) {
      expect(cookie, attribute).toContain(attribute);
    }
  });

  it('case 15: read-only mode refuses a save, unreported, and leaves reads and sign-in open', async () => {
    const reporter = vi.fn();
    const ro = await buildEdgeApp({
      authMode: 'shadow',
      readOnly: true,
      reportException: reporter,
    });
    try {
      const save = await fetch(`${ro.base}/api/v1/edge/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ marker: 'probe-marker-echo' }),
      });
      expect(save.status).toBe(503);
      expect(await save.json()).toMatchObject({ code: READ_ONLY_MODE_CODE });
      expect(reporter).not.toHaveBeenCalled();
      const signIn = await fetch(`${ro.base}/api/v1/auth/edge-allowlisted`, { method: 'POST' });
      expect(signIn.status).toBe(200);
      expect((await fetch(`${ro.base}/api/v1/edge/public`)).status).toBe(200);
    } finally {
      await ro.app.close();
    }
  });

  it('case 15, twin: with read-only off the same save goes through', async () => {
    const save = await fetch(`${edge.base}/api/v1/edge/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ marker: 'probe-marker-echo' }),
    });
    expect(save.status).toBe(200);
  });
});

/**
 * The maintenance lockdown (a global interceptor) locks /api/v1/orgs/ whole for a signed-in
 * account that is not platform staff. The router decodes `%6F` and reads an absolute-form target
 * as its path, so each spelling below reaches the same route, and each must meet the lockdown.
 */
describe('the maintenance lockdown', () => {
  const reporter = vi.fn();
  const targets: Array<[string, (port: number) => string]> = [
    ['the plain address', () => '/api/v1/orgs/probe-marker-org/probe'],
    ['a percent-encoded letter', () => '/api/v1/%6Frgs/probe-marker-org/probe'],
    [
      'an absolute-form target',
      (port) => `http://127.0.0.1:${port}/api/v1/orgs/probe-marker-org/probe`,
    ],
  ];
  let locked: EdgeApp;
  let open: EdgeApp;
  beforeAll(async () => {
    locked = await buildEdgeApp({ authMode: 'shadow', lockdown: true, reportException: reporter });
    open = await buildEdgeApp({ authMode: 'shadow', lockdown: false });
  });
  afterAll(async () => {
    await locked?.app.close();
    await open?.app.close();
  });

  it.each(targets)(
    'case 16: refuses a signed-in save sent as %s, unreported',
    async (_n, target) => {
      const res = await rawRequest(
        locked.port,
        'POST',
        target(locked.port),
        loginCookie(LOGIN_MARKER),
      );
      expect(res.status).toBe(503);
      expect(JSON.parse(res.body)).toMatchObject({ code: ADMIN_LOCKDOWN_CODE });
      expect(reporter).not.toHaveBeenCalled();
    },
  );

  it.each(targets)(
    'case 16, twin: with the lockdown off, %s reaches the route',
    async (_n, target) => {
      const res = await rawRequest(open.port, 'POST', target(open.port), loginCookie(LOGIN_MARKER));
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ ok: 'probe-marker-locked' });
    },
  );

  it('case 16, twin: an anonymous caller is not the lockdown’s to refuse', async () => {
    const res = await rawRequest(locked.port, 'POST', targets[0]![1](locked.port));
    expect(res.status).toBe(200);
  });
});
