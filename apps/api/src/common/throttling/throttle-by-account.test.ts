import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Controller, Delete, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as jwt from 'jsonwebtoken';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { trustOneLocalProxy } from '../trust-proxy';
import {
  AUTH_ACCOUNT_THROTTLER,
  ThrottleByAccount,
  authAccountTracker,
  skipAuthAccountThrottle,
} from './throttle-by-account';
import { throttlerOptions } from './throttler-options';

/**
 * Ten checks of a current password per hour, per signed-in account (operator ruling 359).
 *
 * Somebody sits at Marie's open session and guesses her current password in the
 * change-password box. Each guess is checked by the auth server, and that door had only
 * the API's general limit, 120 a minute. The password change and the account deletion
 * share ten tries an hour now, counted on Marie's account: the whole venue is on one
 * address, so the address would count the wrong thing.
 */
const SECRET = 'test-supabase-jwt-secret-at-least-32-characters-long';
const login = (account: string, secret = SECRET, expiresIn = 3600) =>
  jwt.sign({ sub: account, email: `${account}@example.com` }, secret, { expiresIn });

@Controller('t')
class ProbeController {
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ThrottleByAccount()
  change(): { ok: true } {
    return { ok: true };
  }

  @Delete('account')
  @HttpCode(HttpStatus.OK)
  @ThrottleByAccount()
  remove(): { ok: true } {
    return { ok: true };
  }

  @Post('unmarked')
  @HttpCode(HttpStatus.OK)
  unmarked(): { ok: true } {
    return { ok: true };
  }
}

let app: NestFastifyApplication;
const ORIGINAL = {
  secret: process.env.SUPABASE_JWT_SECRET,
  whitelist: process.env.THROTTLE_IP_WHITELIST,
};

/** One request, each from another address: what trips here is the account's bucket. */
let source = 0;
async function ask(url: string, token: string | null, method: 'POST' | 'DELETE' = 'POST') {
  source += 1;
  const res = await app.inject({
    method,
    url,
    headers: {
      'x-forwarded-for': `10.40.${Math.floor(source / 250)}.${source % 250}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  return res.statusCode;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot(throttlerOptions)],
    controllers: [ProbeController],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ trustProxy: trustOneLocalProxy }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  process.env.SUPABASE_JWT_SECRET = SECRET;
  delete process.env.THROTTLE_IP_WHITELIST;
});

afterEach(() => {
  for (const [name, value] of [
    ['SUPABASE_JWT_SECRET', ORIGINAL.secret],
    ['THROTTLE_IP_WHITELIST', ORIGINAL.whitelist],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('auth-account throttler (wired)', () => {
  it('refuses the 11th check for one account, each from another address', async () => {
    const marie = login('marie-1');

    for (let i = 0; i < 10; i++) expect(await ask('/t/change-password', marie)).toBe(200);
    expect(await ask('/t/change-password', marie)).toBe(429);
  });

  it('counts the password change and the account deletion together', async () => {
    const marie = login('marie-2');

    for (let i = 0; i < 10; i++) expect(await ask('/t/change-password', marie)).toBe(200);
    expect(await ask('/t/account', marie, 'DELETE')).toBe(429);
  });

  it('counts the account, not the login: a renewed login is the same account', async () => {
    for (let i = 0; i < 10; i++) {
      expect(await ask('/t/change-password', login('marie-3', SECRET, 3600 + i))).toBe(200);
    }
    expect(await ask('/t/change-password', login('marie-3', SECRET, 9999))).toBe(429);
  });

  it('leaves another account alone', async () => {
    for (let i = 0; i < 11; i++) await ask('/t/change-password', login('noisy'));

    expect(await ask('/t/change-password', login('bystander'))).toBe(200);
  });

  // A login somebody made up reaches no password check: it must not spend her tries.
  it('does not count a login signed by somebody else, with her account in it', async () => {
    for (let i = 0; i < 12; i++) {
      expect(
        await ask('/t/change-password', login('marie-4', 'another-secret-of-32-characters!!')),
      ).toBe(200);
    }
    expect(await ask('/t/change-password', login('marie-4'))).toBe(200);
  });

  it('does not put the requests with no login, or an expired one, in one bucket', async () => {
    for (let i = 0; i < 12; i++) expect(await ask('/t/change-password', null)).toBe(200);
    for (let i = 0; i < 12; i++) {
      expect(await ask('/t/change-password', login('marie-5', SECRET, -60))).toBe(200);
    }
  });

  it('leaves a route with no mark alone', async () => {
    const marie = login('marie-6');

    for (let i = 0; i < 12; i++) expect(await ask('/t/unmarked', marie)).toBe(200);
  });
});

class Fixture {
  @ThrottleByAccount()
  marked(): void {}

  plain(): void {}
}

const context = (
  request: Record<string, unknown>,
  handler: () => void = Fixture.prototype.marked,
): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
  }) as unknown as ExecutionContext;

describe('the account of a request', () => {
  const bearer = (account: string) => ({ headers: { authorization: `Bearer ${login(account)}` } });

  it('is read from the login cookie as from the header', () => {
    const cookie = { headers: {}, cookies: { 'sb-access-token': login('marie') } };

    expect(authAccountTracker(cookie)).toBe(authAccountTracker(bearer('marie')));
    expect(authAccountTracker(cookie)).not.toBe(authAccountTracker(bearer('paul')));
    expect(skipAuthAccountThrottle(context(cookie))).toBe(false);
  });

  it('is never kept as it is: the store holds a hash', () => {
    expect(authAccountTracker(bearer('marie'))).toMatch(/^[0-9a-f]{64}$/);
    expect(authAccountTracker(bearer('marie'))).not.toContain('marie');
  });

  it('is skipped on a route with no mark, for a whitelisted address, and with no secret', () => {
    expect(skipAuthAccountThrottle(context(bearer('marie'), Fixture.prototype.plain))).toBe(true);

    process.env.THROTTLE_IP_WHITELIST = '10.0.0.1';
    expect(skipAuthAccountThrottle(context({ ...bearer('marie'), ip: '10.0.0.1' }))).toBe(true);
    expect(skipAuthAccountThrottle(context({ ...bearer('marie'), ip: '10.0.0.9' }))).toBe(false);

    // With no secret no login can be checked: there is no account to count on.
    delete process.env.SUPABASE_JWT_SECRET;
    expect(skipAuthAccountThrottle(context(bearer('marie')))).toBe(true);
  });

  it('has a stable throttler name', () => {
    expect(AUTH_ACCOUNT_THROTTLER).toBe('auth-account');
  });
});

describe('the doors that ask a current password', () => {
  const routes = readFileSync(
    join(__dirname, '..', '..', 'modules', 'auth', 'me.controller.ts'),
    'utf8',
  );

  it.each([
    ['the password change', "@Post('me/change-password')"],
    ['the account deletion', "@Delete('me/account')"],
  ])('%s is counted by account', (_door, route) => {
    const at = routes.indexOf(route);
    const head = routes.slice(at, routes.indexOf('async ', at));

    expect(at).toBeGreaterThan(-1);
    expect(head).toContain('@ThrottleByAccount()');
  });

  it('are the only two', () => {
    expect(routes.split('@ThrottleByAccount()')).toHaveLength(3);
  });
});
