import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as jwt from 'jsonwebtoken';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { trustOneLocalProxy } from '../trust-proxy';
import { ThrottleByAccount } from './throttle-by-account';
import { ThrottleFightBookAsk } from './throttle-fightbook-ask';
import { FIGHTBOOK_ASK_THROTTLE } from './throttle-profiles';
import { throttlerOptions } from './throttler-options';

/**
 * Twenty spar requests an hour, per account (FightBook slice 1): a fighter who asks everybody at
 * the venue in a minute is stopped, whatever wifi they are on, and never spends anyone else's
 * allowance nor their own password tries.
 */
const SECRET = 'test-supabase-jwt-secret-at-least-32-characters-long';
const login = (account: string) => jwt.sign({ sub: account }, SECRET, { expiresIn: 3600 });

@Controller('t')
class ProbeController {
  @Post('ask')
  @HttpCode(HttpStatus.CREATED)
  @ThrottleFightBookAsk()
  ask(): { ok: true } {
    return { ok: true };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ThrottleByAccount()
  change(): { ok: true } {
    return { ok: true };
  }
}

let app: NestFastifyApplication;
const ORIGINAL = process.env.SUPABASE_JWT_SECRET;
let source = 0;

async function post(url: string, token: string | null) {
  source += 1;
  const res = await app.inject({
    method: 'POST',
    url,
    headers: {
      'x-forwarded-for': `10.41.${Math.floor(source / 250)}.${source % 250}`,
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
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.SUPABASE_JWT_SECRET;
  else process.env.SUPABASE_JWT_SECRET = ORIGINAL;
});

describe('fightbook-ask throttler (wired)', () => {
  it('is twenty an hour', () => {
    expect(FIGHTBOOK_ASK_THROTTLE).toEqual({ limit: 20, ttl: 3_600_000 });
  });

  it('refuses the 21st ask of one account, each from another address', async () => {
    const marc = login('marc-1');
    for (let i = 0; i < 20; i++) expect(await post('/t/ask', marc)).toBe(201);
    expect(await post('/t/ask', marc)).toBe(429);
  });

  it('leaves another account alone', async () => {
    for (let i = 0; i < 21; i++) await post('/t/ask', login('noisy'));
    expect(await post('/t/ask', login('julie'))).toBe(201);
  });

  it('spends none of the password tries, nor they its asks', async () => {
    const paul = login('paul-1');
    for (let i = 0; i < 20; i++) await post('/t/ask', paul);
    expect(await post('/t/change-password', paul)).toBe(200);
  });

  it('does not put the asks with no login in one bucket', async () => {
    for (let i = 0; i < 22; i++) expect(await post('/t/ask', null)).toBe(201);
  });
});
