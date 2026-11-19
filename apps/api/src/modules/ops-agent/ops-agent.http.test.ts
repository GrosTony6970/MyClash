/**
 * The door's log read through the real HTTP stack (`configureHttpApp`: the global Zod pipe, the
 * exception filter). What it proves: the controller binds the DTOs, so a service off the list
 * (`db`, `supabase-meta`, a path trick) and a line count out of range are a 400 before the ops
 * runner is asked anything (ruling 869). Guards run before pipes, so the key guard is let through
 * here; `agent-door.wall.test.ts` holds the guard itself.
 */
import 'reflect-metadata';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_GLOBAL_PREFIX } from '../../common/global-prefix';
import { configureHttpApp } from '../../common/http-bootstrap';
import { AdminBackupsService } from '../admin/backups.service';
import { AdminHostInfoService } from '../admin/host-info.service';
import { AdminRuntimeHealthService } from '../admin/runtime-health.service';
import { AdminSystemVersionsService } from '../admin/system-versions.service';
import { AdminTlsStatusService } from '../admin/tls-status.service';
import { AgentKeyGuard } from './agent-key.guard';
import { AgentEventsLiveService } from './agent-events-live.service';
import { AgentLogsService } from './agent-logs.service';
import { OpsAgentController } from './ops-agent.controller';

const agentLogs = {
  log: vi.fn(),
  containers: vi.fn(),
};

let app: NestFastifyApplication;
let base: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [OpsAgentController],
    providers: [
      { provide: AdminRuntimeHealthService, useValue: {} },
      { provide: AdminHostInfoService, useValue: {} },
      { provide: AdminSystemVersionsService, useValue: {} },
      { provide: AdminBackupsService, useValue: {} },
      { provide: AdminTlsStatusService, useValue: {} },
      { provide: AgentLogsService, useValue: agentLogs },
      { provide: AgentEventsLiveService, useValue: {} },
    ],
  })
    .overrideGuard(AgentKeyGuard)
    .useValue({ canActivate: () => true })
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: false,
  });
  await configureHttpApp(app, { reportException: () => undefined, requestLog: false });
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as { port: number };
  base = `http://127.0.0.1:${port}/${API_GLOBAL_PREFIX}/ops-agent`;
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  agentLogs.log.mockReset().mockResolvedValue({
    generatedAt: 'g',
    service: 'api',
    lines: [],
    truncated: false,
  });
});

describe("the door's log read, over HTTP", () => {
  it.each([
    'logs/db',
    'logs/supabase-meta',
    'logs/DB',
    'logs/..%2Fdb',
    'logs/api?lines=0',
    'logs/api?lines=501',
    'logs/api?lines=abc',
    'logs/api?errors=maybe',
    'logs/api?other=1',
  ])('refuses %s with a 400, and asks the runner nothing', async (route) => {
    const res = await fetch(`${base}/${route}`);
    expect(res.status).toBe(400);
    expect(agentLogs.log).not.toHaveBeenCalled();
  });

  it('reads a listed service with the line count and the errors flag', async () => {
    const res = await fetch(`${base}/logs/api?lines=50&errors=1`);
    expect(res.status).toBe(200);
    expect(agentLogs.log).toHaveBeenCalledWith('api', { lines: 50, errors: true });
  });

  it('reads 100 lines, every one, when the query says nothing', async () => {
    await fetch(`${base}/logs/worker`);
    expect(agentLogs.log).toHaveBeenCalledWith('worker', { lines: 100, errors: false });
  });
});
