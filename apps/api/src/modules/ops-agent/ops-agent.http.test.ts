/**
 * The door's log read and container action through the real HTTP stack (`configureHttpApp`: the global Zod pipe, the
 * exception filter). What it proves: the controller binds the DTOs, so a service off the list
 * (`db`, `supabase-meta`, a path trick) and a line count out of range are a 400 before the ops
 * runner is asked anything (ruling 869). Guards run before pipes, so the key guard is let through
 * here; `agent-door.wall.test.ts` holds the guard itself.
 */
import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_GLOBAL_PREFIX } from '../../common/global-prefix';
import { configureHttpApp } from '../../common/http-bootstrap';
import { AdminBackupsService } from '../admin/backups.service';
import { AdminHostInfoService } from '../admin/host-info.service';
import { AdminRuntimeHealthService } from '../admin/runtime-health.service';
import { AdminSystemVersionsService } from '../admin/system-versions.service';
import { AdminSystemActionsService } from '../admin/system-actions.service';
import { AdminTlsStatusService } from '../admin/tls-status.service';
import { OpsAgentTraceReader } from '../admin/runtime-health/agent-trace-reader';
import { AgentKeyGuard } from './agent-key.guard';
import { AgentEventsLiveService } from './agent-events-live.service';
import { AgentLogsService } from './agent-logs.service';
import { OpsAgentController } from './ops-agent.controller';

const agentLogs = {
  log: vi.fn(),
};
const systemActions = {
  runComponentAction: vi.fn(),
  renewCertificates: vi.fn(),
  pruneDisk: vi.fn(),
};

let app: NestFastifyApplication;
let base: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [OpsAgentController],
    providers: [
      { provide: AdminRuntimeHealthService, useValue: {} },
      { provide: OpsAgentTraceReader, useValue: {} },
      { provide: AdminHostInfoService, useValue: {} },
      { provide: AdminSystemVersionsService, useValue: {} },
      { provide: AdminBackupsService, useValue: {} },
      { provide: AdminTlsStatusService, useValue: {} },
      { provide: AgentLogsService, useValue: agentLogs },
      { provide: AgentEventsLiveService, useValue: {} },
      { provide: AdminSystemActionsService, useValue: systemActions },
    ],
  })
    .overrideGuard(AgentKeyGuard)
    .useValue({
      canActivate: (context: { switchToHttp: () => { getRequest: () => object } }) => {
        Object.assign(context.switchToHttp().getRequest(), { agentUserId: 'agent-user' });
        return true;
      },
    })
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
  systemActions.runComponentAction.mockReset().mockResolvedValue({
    ok: true,
    service: 'worker',
    action: 'restart',
    exitCode: 0,
    stdout: 'marker-out',
    stderr: 'marker-err',
  });
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

// Slice 4: the door's container action. Only restart and start, only the restartable list.
describe("the door's container action, over HTTP", () => {
  it.each([
    'containers/worker/stop',
    'containers/db/restart',
    'containers/api/restart',
    'containers/traefik/restart',
    'containers/ops-runner/start',
    'containers/..%2Fworker/restart',
    'containers/worker/RESTART',
  ])('refuses %s with a 400, and acts on nothing', async (route) => {
    const res = await fetch(`${base}/${route}`, { method: 'POST' });
    expect(res.status).toBe(400);
    expect(systemActions.runComponentAction).not.toHaveBeenCalled();
  });

  it('restarts a listed service under the key account, and answers six fields', async () => {
    const res = await fetch(`${base}/containers/worker/restart`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(systemActions.runComponentAction).toHaveBeenCalledWith(
      'worker',
      'restart',
      'agent-user',
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ['action', 'exitCode', 'ok', 'scheduled', 'service', 'timedOut'].sort(),
    );
    expect(JSON.stringify(body)).not.toContain('marker');
  });

  it('relays the runner held lock as a 409 ops_busy', async () => {
    systemActions.runComponentAction.mockRejectedValueOnce(
      new ConflictException({ message: 'busy', code: 'ops_busy' }),
    );
    const res = await fetch(`${base}/containers/worker/restart`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe('ops_busy');
  });
});

// Slice 4b: the door's disk prune (rulings 884, 895-896).
describe("the door's disk prune, over HTTP", () => {
  it('prunes under the key account, answers 200 with six fields, and no shell text', async () => {
    systemActions.pruneDisk.mockResolvedValueOnce({
      ok: true,
      exitCode: 0,
      timedOut: false,
      freedBytes: 123,
      availBytes: 456,
      stderr: 'marker-err',
    });
    const res = await fetch(`${base}/disk/prune`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(systemActions.pruneDisk).toHaveBeenCalledWith('agent-user');
    expect(await res.json()).toEqual({
      ok: true,
      service: 'docker',
      action: 'prune',
      exitCode: 0,
      timedOut: false,
      scheduled: false,
    });
  });

  it('relays a deploy in progress as a 409 deploy_running', async () => {
    systemActions.pruneDisk.mockRejectedValueOnce(
      new ConflictException({ message: 'deploy', code: 'deploy_running' }),
    );
    const res = await fetch(`${base}/disk/prune`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe('deploy_running');
  });
});
