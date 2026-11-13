import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as jwt from 'jsonwebtoken';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { trustOneLocalProxy } from '../trust-proxy';
import { ThrottleFightBookQrMint } from './throttle-fightbook-qr-mint';
import { ThrottleFightBookScan } from './throttle-fightbook-scan';
import { FIGHTBOOK_QR_MINT_THROTTLE } from './throttle-profiles';
import { throttlerOptions } from './throttler-options';

/**
 * Sixty QR codes minted an hour, per account (FightBook slice 5, Decision 11): a screen re-minting
 * every 4.5 minutes uses about thirteen. Its own bucket: scanning never stops showing a code, nor
 * showing a code a scan.
 */
const SECRET = 'test-supabase-jwt-secret-at-least-32-characters-long';
const login = (account: string) => jwt.sign({ sub: account }, SECRET, { expiresIn: 3600 });

@Controller('t')
class ProbeController {
  @Post('mint')
  @HttpCode(HttpStatus.CREATED)
  @ThrottleFightBookQrMint()
  mint(): { ok: true } {
    return { ok: true };
  }

  @Post('scan')
  @HttpCode(HttpStatus.CREATED)
  @ThrottleFightBookScan()
  scan(): { ok: true } {
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
      'x-forwarded-for': `10.44.${Math.floor(source / 250)}.${source % 250}`,
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

describe('fightbook-qr-mint throttler (wired)', () => {
  it('is sixty an hour', () => {
    expect(FIGHTBOOK_QR_MINT_THROTTLE).toEqual({ limit: 60, ttl: 3_600_000 });
  });

  it('refuses the 61st code of one account, each from another address', async () => {
    const julie = login('julie-mint');
    for (let i = 0; i < 60; i++) expect(await post('/t/mint', julie)).toBe(201);
    expect(await post('/t/mint', julie)).toBe(429);
  });

  it('leaves another account alone', async () => {
    for (let i = 0; i < 61; i++) await post('/t/mint', login('noisy-mint'));
    expect(await post('/t/mint', login('marc-mint'))).toBe(201);
  });

  it('twenty scans leave the codes whole', async () => {
    const paul = login('paul-scans-then-mints');
    for (let i = 0; i < 20; i++) expect(await post('/t/scan', paul)).toBe(201);
    expect(await post('/t/scan', paul)).toBe(429);
    expect(await post('/t/mint', paul)).toBe(201);
  });

  it('sixty codes leave the scans whole', async () => {
    const lea = login('lea-mints-then-scans');
    for (let i = 0; i < 60; i++) expect(await post('/t/mint', lea)).toBe(201);
    expect(await post('/t/mint', lea)).toBe(429);
    expect(await post('/t/scan', lea)).toBe(201);
  });

  it('does not put the codes with no login in one bucket', async () => {
    for (let i = 0; i < 62; i++) expect(await post('/t/mint', null)).toBe(201);
  });
});
