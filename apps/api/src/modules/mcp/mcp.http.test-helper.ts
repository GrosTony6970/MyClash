/**
 * The MCP door through the real HTTP stack (`configureHttpApp`: the global filter, the prefix)
 * with the real AuthGuard and the real read-only interceptor in front of it, as in production,
 * and real signed logins. Shared by `mcp.http.test.ts` (the door) and `mcp.http.writes.test.ts`
 * (the tools that write). The services behind the tools are doubles.
 */
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, vi } from 'vitest';
import { AuthGuard } from '../../common/auth/auth.guard';
import { API_GLOBAL_PREFIX } from '../../common/global-prefix';
import { configureHttpApp } from '../../common/http-bootstrap';
import { ReadOnlyInterceptor } from '../../common/interceptors/read-only.interceptor';
import { AdminFeatureFlagsService } from '../admin/admin-feature-flags.service';
import { GuestJwtService } from '../auth/guest-jwt.service';
import { EventsService } from '../events/events.service';
import { FightersService } from '../fighters/fighters.service';
import { MatchPlacementService } from '../matches/match-placement.service';
import { MatchesService } from '../matches/matches.service';
import { MeEventsService } from '../me/me-events.service';
import { PublicScheduleService } from '../persons/public-schedule.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { OrganizerAIAssistantService } from '../organizer-ai-assistant/organizer-ai-assistant.service';
import { PoolStandingsService } from '../pool-standings/pool-standings.service';
import { AssignmentBoardService } from '../referees/assignment-board.service';
import { QualificationsService } from '../referees/qualifications.service';
import { ScheduleGridService } from '../schedule/schedule-grid.service';
import { StaffJwtService } from '../staff/staff-jwt.service';
import { verifyAccessTokenLocally } from '../supabase/access-token';
import { SupabaseService } from '../supabase/supabase.service';
import { TournamentQueryToolsService } from '../tournament-query/tournament-query.tools.service';
import { McpController } from './mcp.controller';

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
export const listMyEvents = vi.fn();
export const getUpcoming = vi.fn();
export const getMyDashboard = vi.fn();
export const setRefereeRoleAssignment = vi.fn();
export const createDraftFromAction = vi.fn();
/** The read-only (maintenance) switch the real interceptor and the write tools read. */
export const door = { readOnly: false, url: '' };
/** `feature_flags.select('enabled').eq('key', …).maybeSingle()`, answering `door.readOnly`. */
const flagRead = {
  select: () => flagRead,
  eq: () => flagRead,
  maybeSingle: async () => ({ data: { enabled: door.readOnly }, error: null }),
};
/** Every table a tool asked for: in maintenance, a write tool reads the switch and nothing else. */
export const from = vi.fn((_table: string) => flagRead);
export const connector = jwt.sign(
  { sub: 'user-1', email: 'a@b.c', client_id: 'claude-client' },
  SECRET,
  {
    expiresIn: 3600,
  },
);

/** The real guard and interceptor, and a double for every service the controller takes. */
function doorProviders() {
  return [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ReadOnlyInterceptor },
    {
      provide: AdminFeatureFlagsService,
      useValue: {
        isEnabled: async (flag: string) => flag === 'read_only_mode' && door.readOnly,
      },
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
      useValue: {
        verifyAccessTokenLocal: (t: string) => verifyAccessTokenLocally(t, SECRET),
        // The read-only switch as a write tool reads it (`assertNotReadOnly`).
        service: { from },
      },
    },
    { provide: GuestJwtService, useValue: refuse },
    { provide: StaffJwtService, useValue: refuse },
    { provide: OrganizationsService, useValue: {} },
    { provide: PublicScheduleService, useValue: {} },
    { provide: EventsService, useValue: {} },
    { provide: ScheduleGridService, useValue: {} },
    { provide: PoolStandingsService, useValue: {} },
    { provide: TournamentQueryToolsService, useValue: {} },
    { provide: MatchesService, useValue: { setRefereeRoleAssignment } },
    { provide: AssignmentBoardService, useValue: {} },
    { provide: QualificationsService, useValue: {} },
    { provide: OrganizerAIAssistantService, useValue: { createDraftFromAction } },
    { provide: MatchPlacementService, useValue: {} },
    { provide: FightersService, useValue: { getMyDashboard } },
    { provide: MeEventsService, useValue: { listMyEvents, getUpcoming } },
  ];
}

/** Starts the door before the file's tests, stops it after, and resets the doubles before each. */
export function useMcpDoor(): void {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [McpController],
      providers: doorProviders(),
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    await configureHttpApp(app, { reportException: () => undefined, requestLog: false });
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as { port: number };
    door.url = `http://127.0.0.1:${port}/${API_GLOBAL_PREFIX}/mcp`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    door.readOnly = false;
    setRefereeRoleAssignment.mockReset();
    createDraftFromAction.mockReset();
    from.mockClear();
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
}

export function rpc(method: string, params: object = {}, token: string | null = connector) {
  return fetch(door.url, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

/** A JSON-RPC answer's tool result. */
export interface ToolResultBody {
  result: { isError?: boolean; content: [{ text: string }] };
}
