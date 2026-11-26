/**
 * The MCP door through the real HTTP stack (`configureHttpApp`: the global filter, the prefix)
 * with the real AuthGuard in front of it, as in production, and real signed logins. What it
 * proves: Claude's three first calls answer, the 401 challenge survives the exception filter, a
 * GET is a 405, and the real read-only interceptor lets the door's reads answer (ruling 985).
 */
import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGuard } from '../../common/auth/auth.guard';
import { API_GLOBAL_PREFIX } from '../../common/global-prefix';
import { configureHttpApp } from '../../common/http-bootstrap';
import { ReadOnlyInterceptor } from '../../common/interceptors/read-only.interceptor';
import { AdminFeatureFlagsService } from '../admin/admin-feature-flags.service';
import { GuestJwtService } from '../auth/guest-jwt.service';
import { EventsService } from '../events/events.service';
import { FightersService } from '../fighters/fighters.service';
import { MeEventsService } from '../me/me-events.service';
import { PublicScheduleService } from '../persons/public-schedule.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { PoolStandingsService } from '../pool-standings/pool-standings.service';
import { ScheduleGridService } from '../schedule/schedule-grid.service';
import { StaffJwtService } from '../staff/staff-jwt.service';
import { verifyAccessTokenLocally } from '../supabase/access-token';
import { SupabaseService } from '../supabase/supabase.service';
import { TournamentQueryToolsService } from '../tournament-query/tournament-query.tools.service';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MCP_INTERNAL_ERROR, McpController } from './mcp.controller';

const SECRET = 'test-supabase-jwt-secret-at-least-32-characters-long';
const env: Record<string, string> = {
  AUTH_GUARD_MODE: 'enforce',
  DOMAIN: 'myclash.fr',
  SUPABASE_URL: 'https://app.myclash.fr',
};
const refuse = {
  verify: () => {
    throw new Error('no such cookie');
  },
};
const listMyEvents = vi.fn();
const getUpcoming = vi.fn();
const getMyDashboard = vi.fn();
/** The read-only (maintenance) switch the real interceptor reads. */
let readOnly = false;
const connector = jwt.sign({ sub: 'user-1', email: 'a@b.c', client_id: 'claude-client' }, SECRET, {
  expiresIn: 3600,
});

let app: NestFastifyApplication;
let url: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [McpController],
    providers: [
      { provide: APP_GUARD, useClass: AuthGuard },
      { provide: APP_INTERCEPTOR, useClass: ReadOnlyInterceptor },
      {
        provide: AdminFeatureFlagsService,
        useValue: { isEnabled: async (flag: string) => flag === 'read_only_mode' && readOnly },
      },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) => env[key],
          getOrThrow: (key: string) => {
            if (env[key] === undefined) throw new Error(`missing ${key}`);
            return env[key];
          },
        },
      },
      {
        provide: SupabaseService,
        useValue: { verifyAccessTokenLocal: (t: string) => verifyAccessTokenLocally(t, SECRET) },
      },
      { provide: GuestJwtService, useValue: refuse },
      { provide: StaffJwtService, useValue: refuse },
      { provide: OrganizationsService, useValue: {} },
      { provide: PublicScheduleService, useValue: {} },
      { provide: EventsService, useValue: {} },
      { provide: ScheduleGridService, useValue: {} },
      { provide: PoolStandingsService, useValue: {} },
      { provide: TournamentQueryToolsService, useValue: {} },
      { provide: FightersService, useValue: { getMyDashboard } },
      { provide: MeEventsService, useValue: { listMyEvents, getUpcoming } },
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: false,
  });
  await configureHttpApp(app, { reportException: () => undefined, requestLog: false });
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as { port: number };
  url = `http://127.0.0.1:${port}/${API_GLOBAL_PREFIX}/mcp`;
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  readOnly = false;
  getUpcoming.mockReset().mockResolvedValue([]);
  getMyDashboard.mockReset();
  listMyEvents.mockReset().mockResolvedValue([
    {
      event: { id: 'event-uuid', name: 'FAL 2026', slug: 'fal-2026', startDate: '2026-03-14' },
      roles: {
        isCompetitor: true,
        isReferee: false,
        isWorkshopParticipant: false,
        isInstructor: false,
      },
    },
  ]);
});

function rpc(method: string, params: object = {}, token: string | null = connector) {
  return fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

describe('the MCP door, over HTTP', () => {
  it('answers initialize as myclash', async () => {
    const res = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '0' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { serverInfo: { name: string } } };
    expect(body.result.serverInfo.name).toBe('myclash');
  });

  it('lists every tool, sorted', async () => {
    const res = await rpc('tools/list');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((t) => t.name).sort()).toEqual([
      'compare_clubs',
      'estimate_pool_completion',
      'event_info',
      'event_schedule',
      'find_fighters',
      'find_lagging_pools',
      'find_matches',
      'get_bracket_status',
      'get_fighter_stats',
      'get_judge_stats',
      'get_ring_status',
      'get_schedule_status',
      'get_tournament_summary',
      'my_events',
      'my_fight_history',
      'my_schedule',
      'my_stats',
      'my_upcoming',
      'my_workshops',
      'rank_fighters',
      'tournament_standings',
      'whoami',
    ]);
  });

  it('refuses a limit past the cap before the tool runs', async () => {
    const res = await rpc('tools/call', { name: 'my_upcoming', arguments: { limit: 51 } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { isError?: boolean; content: [{ text: string }] };
      error?: unknown;
    };
    // The SDK answers a bad argument as a tool error result (or a JSON-RPC error): never a run.
    expect(body.result?.isError === true || body.error !== undefined).toBe(true);
    expect(getUpcoming).not.toHaveBeenCalled();
  });

  it('refuses a fight-history limit past ten before the tool runs', async () => {
    const res = await rpc('tools/call', { name: 'my_fight_history', arguments: { limit: 11 } });
    const body = (await res.json()) as { result?: { isError?: boolean }; error?: unknown };
    expect(body.result?.isError === true || body.error !== undefined).toBe(true);
    expect(getMyDashboard).not.toHaveBeenCalled();
  });

  it('answers a refusal as an error result with its one sentence, not a success', async () => {
    getMyDashboard.mockRejectedValue(new NotFoundException('no profile'));
    const res = await rpc('tools/call', { name: 'my_stats', arguments: {} });
    const body = (await res.json()) as {
      result: { isError?: boolean; content: [{ text: string }] };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toBe('You have no fighter profile yet.');
  });

  it('calls whoami for the signed-in account', async () => {
    const res = await rpc('tools/call', { name: 'whoami', arguments: {} });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { content: [{ type: string; text: string }] } };
    expect(listMyEvents).toHaveBeenCalledWith({ userId: 'user-1', staff: null });
    expect(JSON.parse(body.result.content[0].text)).toEqual({
      email: 'a@b.c',
      events: [{ name: 'FAL 2026', slug: 'fal-2026', startDate: '2026-03-14', roles: ['fighter'] }],
    });
  });

  // Ruling 985: a referee asks "when is my next bout?" while MyClash is in maintenance. Every MCP
  // call is a POST, so the read-only switch refused the question with the writes.
  it('answers a read tool while MyClash is read-only', async () => {
    readOnly = true;
    const res = await rpc('tools/call', { name: 'whoami', arguments: {} });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { isError?: boolean } };
    expect(body.result.isError).toBeUndefined();
    expect(listMyEvents).toHaveBeenCalledWith({ userId: 'user-1', staff: null });
  });

  // The door passes read-only mode whole only because no tool writes. A write tool (slice 4)
  // calls `assertNotReadOnly` itself, and is marked so here, before this list may change.
  it('marks every tool read-only: the door passes maintenance on that alone', async () => {
    const res = await rpc('tools/list');
    const body = (await res.json()) as {
      result: { tools: { name: string; annotations?: { readOnlyHint?: boolean } }[] };
    };
    const notReadOnly = body.result.tools.filter((t) => t.annotations?.readOnlyHint !== true);
    expect(notReadOnly.map((t) => t.name)).toEqual([]);
  });

  it('answers a failed tool with a plain error, never its cause', async () => {
    listMyEvents.mockRejectedValue(new Error('relation "secret_table" does not exist'));
    const res = await rpc('tools/call', { name: 'whoami', arguments: {} });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { isError: boolean; content: [{ text: string }] };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toBe('MyClash could not answer this. Try again later.');
  });

  it('answers 500 with a JSON-RPC error when the transport fails, and ends the reply', async () => {
    const spy = vi
      .spyOn(StreamableHTTPServerTransport.prototype, 'handleRequest')
      .mockRejectedValueOnce(new Error('transport broke'));
    try {
      const res = await rpc('tools/list', {});
      expect(res.status).toBe(500);
      expect(res.headers.get('content-type')).toBe('application/json');
      expect(await res.text()).toBe(MCP_INTERNAL_ERROR);
    } finally {
      spy.mockRestore();
    }
  });

  it('ends the reply when the transport fails after it began to answer', async () => {
    const spy = vi
      .spyOn(StreamableHTTPServerTransport.prototype, 'handleRequest')
      .mockImplementationOnce(async (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"jsonrpc":');
        throw new Error('transport broke mid-answer');
      });
    try {
      const res = await rpc('tools/list', {});
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('{"jsonrpc":');
    } finally {
      spy.mockRestore();
    }
  });

  it('answers a call with no login 401, with the challenge past the exception filter', async () => {
    const res = await rpc('tools/list', {}, null);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="https://api.myclash.fr/.well-known/oauth-protected-resource/api/v1/mcp", scope="email profile offline_access"',
    );
    expect(listMyEvents).not.toHaveBeenCalled();
  });

  it('answers a GET 405, naming POST', async () => {
    const res = await fetch(url, {
      headers: { accept: 'text/event-stream', authorization: `Bearer ${connector}` },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
});
