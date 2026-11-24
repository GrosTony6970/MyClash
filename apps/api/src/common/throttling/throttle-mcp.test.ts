import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as jwt from 'jsonwebtoken';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { McpDoor } from '../../modules/mcp/mcp-door.decorator';
import { McpDoorGuard } from '../../modules/mcp/mcp-door.guard';
import { trustOneLocalProxy } from '../trust-proxy';
import { MCP_ANON_THROTTLE, MCP_THROTTLE } from './throttle-profiles';
import { throttlerOptions } from './throttler-options';

/**
 * The MCP door counts each account, not each address: every person's Claude calls from
 * Anthropic's few addresses, so 120 a minute per address would let one busy person stop
 * everybody. The probe carries the real `McpDoor`; its sign-in guard is let through here
 * (`mcp-door.guard.test.ts` holds it).
 */
const SECRET = 'test-supabase-jwt-secret-at-least-32-characters-long';
const login = (account: string) => jwt.sign({ sub: account }, SECRET, { expiresIn: 3600 });

@McpDoor()
@Controller('t')
class DoorProbeController {
  @Post('mcp')
  @HttpCode(HttpStatus.OK)
  call(): { ok: true } {
    return { ok: true };
  }
}

@Controller('u')
class UnmarkedProbeController {
  @Post('other')
  @HttpCode(HttpStatus.OK)
  other(): { ok: true } {
    return { ok: true };
  }
}

let app: NestFastifyApplication;
const ORIGINAL = process.env.SUPABASE_JWT_SECRET;
let source = 0;

async function post(url: string, token: string | null, ip?: string) {
  source += 1;
  const res = await app.inject({
    method: 'POST',
    url,
    headers: {
      'x-forwarded-for': ip ?? `10.51.${Math.floor(source / 250)}.${source % 250}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  return res.statusCode;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot(throttlerOptions)],
    controllers: [DoorProbeController, UnmarkedProbeController],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  })
    .overrideGuard(McpDoorGuard)
    .useValue({ canActivate: () => true })
    .compile();
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

describe('mcp throttler (wired)', () => {
  it('is 120 a minute', () => {
    expect(MCP_THROTTLE).toEqual({ limit: 120, ttl: 60_000 });
  });

  it('refuses the 121st call of one account, each from another address', async () => {
    const marc = login('mcp-marc');
    for (let i = 0; i < 120; i++) expect(await post('/t/mcp', marc)).toBe(200);
    expect(await post('/t/mcp', marc)).toBe(429);
  });

  it('leaves another account alone', async () => {
    const noisy = login('mcp-noisy');
    for (let i = 0; i < 121; i++) await post('/t/mcp', noisy);
    expect(await post('/t/mcp', login('mcp-julie'))).toBe(200);
  });

  it('lets many accounts call from one address past the per-address 120', async () => {
    for (let i = 0; i < 125; i++) {
      expect(await post('/t/mcp', login(`mcp-shared-${i}`), '10.52.0.1')).toBe(200);
    }
  });

  it('counts nothing on a route without the mark, which keeps the per-address limit', async () => {
    const paul = login('mcp-paul');
    for (let i = 0; i < 120; i++) expect(await post('/u/other', paul, '10.53.0.1')).toBe(200);
    expect(await post('/u/other', paul, '10.53.0.1')).toBe(429);
    expect(await post('/t/mcp', paul)).toBe(200);
  });

  it('does not put the calls with no login in one account bucket', async () => {
    for (let i = 0; i < 122; i++) expect(await post('/t/mcp', null)).toBe(200);
  });
});

describe('mcp-anon throttler (wired)', () => {
  it('is 60 a minute', () => {
    expect(MCP_ANON_THROTTLE).toEqual({ limit: 60, ttl: 60_000 });
  });

  it('refuses the 61st call with no login from one address', async () => {
    for (let i = 0; i < 60; i++) expect(await post('/t/mcp', null, '10.54.0.1')).toBe(200);
    expect(await post('/t/mcp', null, '10.54.0.1')).toBe(429);
  });

  it('counts no call that carries a login, from that same address', async () => {
    for (let i = 0; i < 61; i++) await post('/t/mcp', null, '10.55.0.1');
    expect(await post('/t/mcp', login('mcp-claude-user'), '10.55.0.1')).toBe(200);
    for (let i = 0; i < 70; i++) await post('/t/mcp', login(`mcp-many-${i}`), '10.56.0.1');
    expect(await post('/t/mcp', null, '10.56.0.1')).toBe(200);
  });

  it('counts nothing on a route without the mark', async () => {
    for (let i = 0; i < 70; i++) expect(await post('/u/other', null, '10.57.0.1')).toBe(200);
  });

  it('does not count a call with an expired but signed login, so a 429 never hides invalid_token', async () => {
    const expired = jwt.sign({ sub: 'mcp-expired' }, SECRET, { expiresIn: -60 });
    for (let i = 0; i < 70; i++) expect(await post('/t/mcp', expired, '10.58.0.1')).toBe(200);
    for (let i = 0; i < 60; i++) expect(await post('/t/mcp', null, '10.58.0.1')).toBe(200);
    expect(await post('/t/mcp', null, '10.58.0.1')).toBe(429);
  });

  it('counts a junk Bearer like no login', async () => {
    for (let i = 0; i < 60; i++) expect(await post('/t/mcp', 'junk', '10.59.0.1')).toBe(200);
    expect(await post('/t/mcp', 'junk', '10.59.0.1')).toBe(429);
  });

  it('counts a token signed with the wrong secret like no login', async () => {
    const forged = jwt.sign({ sub: 'mcp-forged' }, `${SECRET}-other`, { expiresIn: -60 });
    for (let i = 0; i < 60; i++) expect(await post('/t/mcp', forged, '10.60.0.1')).toBe(200);
    expect(await post('/t/mcp', forged, '10.60.0.1')).toBe(429);
  });
});
