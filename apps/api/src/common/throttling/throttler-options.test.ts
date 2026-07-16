import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AUTH_ACTION_THROTTLE } from './throttle-profiles';
import { ThrottleByEmail } from './throttle-by-email';
import { throttlerOptions } from './throttler-options';

/**
 * Drives real requests through ThrottlerGuard with the app's actual throttler
 * config. The unit tests cover the tracker/skip predicates in isolation; this
 * covers the wiring they depend on — that the named throttler is registered, that
 * the email tracker reads a parsed body, and that `trustProxy` makes X-Forwarded-For
 * the thing `req.ip` resolves to.
 */
@Controller('t')
class ProbeController {
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_ACTION_THROTTLE)
  @ThrottleByEmail()
  login(@Body() _body: unknown): { ok: true } {
    return { ok: true };
  }

  @Post('other-login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_ACTION_THROTTLE)
  @ThrottleByEmail()
  otherLogin(@Body() _body: unknown): { ok: true } {
    return { ok: true };
  }

  @Post('unmarked')
  @HttpCode(HttpStatus.OK)
  unmarked(@Body() _body: unknown): { ok: true } {
    return { ok: true };
  }
}

let app: NestFastifyApplication;

const ORIGINAL = process.env.THROTTLE_IP_WHITELIST;

async function post(url: string, email: string | undefined, ip: string): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url,
    // Each call comes from a different source IP, so anything that trips here is
    // the email bucket, not the per-IP one.
    headers: { 'x-forwarded-for': ip },
    payload: email === undefined ? {} : { email },
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
    // Mirrors main.ts: without trustProxy the X-Forwarded-For above is ignored
    // and every request in this file would share one bucket.
    new FastifyAdapter({ trustProxy: 1 }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.THROTTLE_IP_WHITELIST;
  else process.env.THROTTLE_IP_WHITELIST = ORIGINAL;
});

describe('auth-email throttler (wired)', () => {
  it('blocks the 11th login for one address even when every attempt is a different IP', async () => {
    delete process.env.THROTTLE_IP_WHITELIST;
    const email = 'target-1@example.com';

    for (let i = 0; i < 10; i++) {
      expect(await post('/t/login', email, `10.1.0.${i}`)).toBe(200);
    }
    // This is the case the per-IP limit cannot see: 11 sources, one account.
    expect(await post('/t/login', email, '10.1.0.99')).toBe(429);
  });

  it('shares one bucket across login surfaces, so a second route is not a fresh allowance', async () => {
    delete process.env.THROTTLE_IP_WHITELIST;
    const email = 'target-2@example.com';

    for (let i = 0; i < 10; i++) {
      expect(await post('/t/login', email, `10.2.0.${i}`)).toBe(200);
    }
    expect(await post('/t/other-login', email, '10.2.0.99')).toBe(429);
  });

  it('is keyed per address — one exhausted account does not lock out another', async () => {
    delete process.env.THROTTLE_IP_WHITELIST;

    for (let i = 0; i < 11; i++) await post('/t/login', 'noisy@example.com', `10.3.0.${i}`);
    expect(await post('/t/login', 'bystander@example.com', '10.3.0.99')).toBe(200);
  });

  it('normalizes case, so capitalization is not a way around the limit', async () => {
    delete process.env.THROTTLE_IP_WHITELIST;

    for (let i = 0; i < 10; i++) {
      expect(await post('/t/login', 'target-3@example.com', `10.4.0.${i}`)).toBe(200);
    }
    expect(await post('/t/login', 'TARGET-3@Example.com', '10.4.0.99')).toBe(429);
  });

  it('leaves unmarked routes alone', async () => {
    delete process.env.THROTTLE_IP_WHITELIST;

    for (let i = 0; i < 12; i++) {
      expect(await post('/t/unmarked', 'target-4@example.com', `10.5.0.${i}`)).toBe(200);
    }
  });

  it('exempts whitelisted IPs', async () => {
    process.env.THROTTLE_IP_WHITELIST = '10.6.0.1';
    const email = 'target-5@example.com';

    for (let i = 0; i < 15; i++) {
      expect(await post('/t/login', email, '10.6.0.1')).toBe(200);
    }
  });
});

describe('per-IP throttler (wired)', () => {
  it('still bounds one IP hammering many accounts', async () => {
    delete process.env.THROTTLE_IP_WHITELIST;

    // AUTH_ACTION_THROTTLE is 10/hour on the `global` throttler; a distinct
    // address each time means only the IP bucket can trip.
    for (let i = 0; i < 10; i++) {
      expect(await post('/t/login', `spray-${i}@example.com`, '10.7.0.1')).toBe(200);
    }
    expect(await post('/t/login', 'spray-99@example.com', '10.7.0.1')).toBe(429);
  });

  it('resolves req.ip from X-Forwarded-For, so clients do not share a bucket', async () => {
    delete process.env.THROTTLE_IP_WHITELIST;

    for (let i = 0; i < 10; i++) {
      expect(await post('/t/login', `neighbour-${i}@example.com`, '10.8.0.1')).toBe(200);
    }
    // Same handler, different client. Pre-trustProxy this was a 429: req.ip was
    // the proxy's address for everyone.
    expect(await post('/t/login', 'newcomer@example.com', '10.8.0.2')).toBe(200);
  });
});
