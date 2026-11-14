import { type CanActivate, type ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Identity } from '../../common/auth/identity';
import { configureHttpApp } from '../../common/http-bootstrap';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { SupabaseService } from '../supabase/supabase.service';
import { FightBookBlocksService } from './fightbook-blocks.service';
import { FightBookSettingsService } from './fightbook-settings.service';
import { FightBookController } from './fightbook.controller';
import { SparFindService } from './spar-find.service';
import { SparReadsService } from './spar-reads.service';
import { SparRequestsService } from './spar-requests.service';

/**
 * A refused daily-limit save writes nothing, through the app's real HTTP pipeline: the global Zod
 * pipe of `configureHttpApp` in front of the real `FightBookController`. A direct handler call
 * skips the pipe, so only a request proves the schema's bounds hold on the route.
 */
const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const ACCOUNT = '9a8b7c6d-1111-4222-8333-944455566677';
const URL = '/api/v1/me/fightbook/settings';

const claimed: Identity = { kind: 'claimed', userId: ACCOUNT, email: null };

/** Sets the identity on every request, as the real guard does, before any pipe runs. */
const claimedGuard: CanActivate = {
  canActivate(context: ExecutionContext) {
    (context.switchToHttp().getRequest() as { identity?: Identity }).identity = claimed;
    return true;
  },
};

const set = vi.fn(async (_caller: unknown, dto: unknown) => dto);
let app: NestFastifyApplication;

beforeAll(async () => {
  const profile = mockSupabase({
    global_persons: {
      rows: [
        {
          id: MARC,
          claimed_by_user_id: ACCOUNT,
          fightbook_enabled: true,
          deleted_at: null,
          merged_into_id: null,
          account_deleted_at: null,
        },
      ],
    },
  });
  const moduleRef = await Test.createTestingModule({
    controllers: [FightBookController],
    providers: [
      { provide: APP_GUARD, useValue: claimedGuard },
      { provide: SupabaseService, useValue: { service: profile.service } },
      { provide: FightBookSettingsService, useValue: { get: vi.fn(), set } },
      { provide: SparRequestsService, useValue: {} },
      { provide: SparReadsService, useValue: {} },
      { provide: FightBookBlocksService, useValue: {} },
      { provide: SparFindService, useValue: {} },
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureHttpApp(app, { reportException: () => undefined });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  set.mockClear();
});

const patch = (payload: Record<string, number>) =>
  app.inject({ method: 'PATCH', url: URL, payload });

describe('PATCH /api/v1/me/fightbook/settings (the real pipe)', () => {
  it.each([
    ['above the most (25)', { dailyLimit: 25 }],
    ['below the least (0)', { dailyLimit: 0 }],
    ['not a whole number (2.5)', { dailyLimit: 2.5 }],
    ['nothing to change', {}],
  ])('refuses a limit %s with 400 and saves nothing', async (_name, body) => {
    const res = await patch(body);
    expect(res.statusCode).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });

  it('saves a valid limit once, with the parsed value', async () => {
    const res = await patch({ dailyLimit: 3 });
    expect(res.statusCode).toBe(200);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0]?.[1]).toEqual({ dailyLimit: 3 });
  });
});
