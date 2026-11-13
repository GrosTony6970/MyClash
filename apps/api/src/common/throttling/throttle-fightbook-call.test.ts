import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as jwt from 'jsonwebtoken';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { trustOneLocalProxy } from '../trust-proxy';
import { ThrottleFightBookAsk } from './throttle-fightbook-ask';
import { ThrottleFightBookCall } from './throttle-fightbook-call';
import { FIGHTBOOK_CALL_THROTTLE } from './throttle-profiles';
import { throttlerOptions } from './throttler-options';

/**
 * Twenty open calls posted an hour, per account (FightBook slice 5, Ruling L): the cap bounds OPEN
 * calls only, so a fighter posting and closing in a loop is stopped here. Its own bucket: twenty
 * asks never stop a post, nor twenty posts an ask.
 */
const SECRET = 'test-supabase-jwt-secret-at-least-32-characters-long';
const login = (account: string) => jwt.sign({ sub: account }, SECRET, { expiresIn: 3600 });

@Controller('t')
class ProbeController {
  @Post('call')
  @HttpCode(HttpStatus.CREATED)
  @ThrottleFightBookCall()
  call(): { ok: true } {
    return { ok: true };
  }

  @Post('ask')
  @HttpCode(HttpStatus.CREATED)
  @ThrottleFightBookAsk()
  ask(): { ok: true } {
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
      'x-forwarded-for': `10.42.${Math.floor(source / 250)}.${source % 250}`,
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

describe('fightbook-call throttler (wired)', () => {
  it('is twenty an hour', () => {
    expect(FIGHTBOOK_CALL_THROTTLE).toEqual({ limit: 20, ttl: 3_600_000 });
  });

  it('refuses the 21st post of one account, each from another address', async () => {
    const marc = login('marc-call');
    for (let i = 0; i < 20; i++) expect(await post('/t/call', marc)).toBe(201);
    expect(await post('/t/call', marc)).toBe(429);
  });

  it('leaves another account alone', async () => {
    for (let i = 0; i < 21; i++) await post('/t/call', login('noisy-call'));
    expect(await post('/t/call', login('julie-call'))).toBe(201);
  });

  it('twenty asks leave the posts whole', async () => {
    const paul = login('paul-asks');
    for (let i = 0; i < 20; i++) expect(await post('/t/ask', paul)).toBe(201);
    expect(await post('/t/ask', paul)).toBe(429);
    expect(await post('/t/call', paul)).toBe(201);
  });

  it('twenty posts leave the asks whole', async () => {
    const lea = login('lea-calls');
    for (let i = 0; i < 20; i++) expect(await post('/t/call', lea)).toBe(201);
    expect(await post('/t/call', lea)).toBe(429);
    expect(await post('/t/ask', lea)).toBe(201);
  });

  it('does not put the posts with no login in one bucket', async () => {
    for (let i = 0; i < 22; i++) expect(await post('/t/call', null)).toBe(201);
  });
});
