import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RESTARTABLE_COMPONENTS } from './restartable-components';
import {
  AdminSystemActionsService,
  RESTARTABLE_SERVICES,
  componentKeyForService,
} from './system-actions.service';

const audits: Record<string, unknown>[] = [];

const supabaseStub = {
  service: {
    from: vi.fn(() => ({
      insert: vi.fn((payload: Record<string, unknown>) => {
        audits.push(payload);
        return Promise.resolve({ data: null, error: null });
      }),
    })),
  },
};

function makeService(fetchImpl: typeof fetch) {
  return new AdminSystemActionsService(supabaseStub as never, {
    opsRunnerUrl: 'http://ops-runner:4075',
    opsRunnerSecret: 'shhh',
    fetchImpl,
  });
}

describe('AdminSystemActionsService', () => {
  beforeEach(() => {
    audits.length = 0;
    vi.clearAllMocks();
  });

  it('rejects a non-allowlisted component key with 403', async () => {
    const fetchImpl = vi.fn();
    const service = makeService(fetchImpl as unknown as typeof fetch);
    await expect(service.runComponentAction('postgres', 'restart', 'actor')).rejects.toThrow(
      ForbiddenException,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects an unknown action with 400', async () => {
    const fetchImpl = vi.fn();
    const service = makeService(fetchImpl as unknown as typeof fetch);
    await expect(
      service.runComponentAction('web-admin', 'reboot' as never, 'actor'),
    ).rejects.toThrow(BadRequestException);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws 503 when the ops-runner is not configured', async () => {
    const service = new AdminSystemActionsService(supabaseStub as never, {
      opsRunnerUrl: '',
      opsRunnerSecret: '',
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(service.runComponentAction('web-admin', 'restart', 'actor')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('calls ops-runner with the correct path + bearer and writes an audit-log row', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return new Response(
        JSON.stringify({
          ok: true,
          service: 'web-admin',
          action: 'restart',
          exitCode: 0,
          stdout: 'Restarted web-admin',
          stderr: '',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const service = makeService(fetchImpl);

    const result = await service.runComponentAction('web-admin', 'restart', 'tony-user-id');

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://ops-runner:4075/containers/web-admin/restart');
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>)['authorization']).toBe('Bearer shhh');

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_user_id: 'tony-user-id',
      action: 'system.component.restart',
      entity_type: 'system_component',
      entity_id: 'web-admin',
    });
  });

  it('maps the postgrest UI key to its supabase-rest compose service name', async () => {
    const calls: { url: string }[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push({ url });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const service = makeService(fetchImpl);
    await service.runComponentAction('postgrest', 'restart', 'actor');
    expect(calls[0]!.url).toBe('http://ops-runner:4075/containers/supabase-rest/restart');
  });

  it('surfaces ops-runner failures as ServiceUnavailableException', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 }));
    const service = makeService(fetchImpl as unknown as typeof fetch);
    await expect(service.runComponentAction('web-admin', 'restart', 'actor')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  describe('renewCertificates', () => {
    it('calls the dedicated renew-certs route with bearer auth and audits the action', async () => {
      const calls: { url: string; init: RequestInit }[] = [];
      const fetchImpl = (async (url: string, init?: RequestInit) => {
        calls.push({ url, init: init ?? {} });
        return new Response(
          JSON.stringify({ ok: true, service: 'traefik', action: 'renew-certs', exitCode: 0 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch;
      const service = makeService(fetchImpl);

      const result = await service.renewCertificates('tony-user-id');

      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe('http://ops-runner:4075/operations/renew-certs');
      expect(calls[0]!.init.method).toBe('POST');
      expect((calls[0]!.init.headers as Record<string, string>)['authorization']).toBe(
        'Bearer shhh',
      );
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actor_user_id: 'tony-user-id',
        action: 'system.tls.renew',
        entity_type: 'system_tls',
        entity_id: 'traefik',
      });
    });

    it('throws 503 when the ops-runner is not configured', async () => {
      const service = new AdminSystemActionsService(supabaseStub as never, {
        opsRunnerUrl: '',
        opsRunnerSecret: '',
        fetchImpl: vi.fn() as unknown as typeof fetch,
      });
      await expect(service.renewCertificates('actor')).rejects.toThrow(ServiceUnavailableException);
    });

    it('surfaces ops-runner failures as ServiceUnavailableException and does not audit', async () => {
      const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
      const service = makeService(fetchImpl as unknown as typeof fetch);
      await expect(service.renewCertificates('actor')).rejects.toThrow(ServiceUnavailableException);
      expect(audits).toHaveLength(0);
    });
  });

  // Slice 4 of the ops agent: the runner's own refusals reach the caller with their status and
  // code (ruling 886's lock, 887's deploy), through the API's one road to it (OpsRunnerClient).
  describe('a refusal of the runner', () => {
    const refusing = (code: string) =>
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'busy', code }), {
            status: 409,
            headers: { 'content-type': 'application/json' },
          }),
      ) as unknown as typeof fetch;

    for (const code of ['ops_busy', 'deploy_running']) {
      it(`relays a 409 ${code} on a container action, with no audit row`, async () => {
        const service = makeService(refusing(code));
        const error = await service.runComponentAction('worker', 'restart', 'a').catch((e) => e);
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({ code });
        expect(audits).toHaveLength(0);
      });

      it(`relays a 409 ${code} on a renewal, with no audit row`, async () => {
        const service = makeService(refusing(code));
        const error = await service.renewCertificates('a').catch((e) => e);
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({ code });
        expect(audits).toHaveLength(0);
      });
    }

    it('says the ops runner is missing in words that fit every action', async () => {
      const service = new AdminSystemActionsService(supabaseStub as never, {
        opsRunnerUrl: '',
        opsRunnerSecret: '',
      });
      await expect(service.runComponentAction('worker', 'restart', 'a')).rejects.toThrow(
        'This action requires the ops runner.',
      );
    });
  });

  describe('the budget of each call', () => {
    const ok = (async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;

    async function budgetOf(call: (s: AdminSystemActionsService) => Promise<unknown>) {
      const spy = vi.spyOn(AbortSignal, 'timeout');
      try {
        await call(makeService(ok));
        return spy.mock.calls.map(([ms]) => ms);
      } finally {
        spy.mockRestore();
      }
    }

    it('a worker action waits 295 s, past the runner own 285 s', async () => {
      expect(await budgetOf((s) => s.runComponentAction('worker', 'restart', 'a'))).toEqual([
        295_000,
      ]);
    });

    it('any other action, the renewal and the disk read wait 35 s; host facts 8 s', async () => {
      expect(await budgetOf((s) => s.runComponentAction('web-admin', 'restart', 'a'))).toEqual([
        35_000,
      ]);
      expect(await budgetOf((s) => s.renewCertificates('a'))).toEqual([35_000]);
      expect(await budgetOf((s) => s.getDiskUsage())).toEqual([35_000]);
      expect(await budgetOf((s) => s.getHostFacts())).toEqual([8_000]);
    });
  });

  describe('the restartable list', () => {
    it('is the values of the component map, and maps a service back to its key', () => {
      expect([...RESTARTABLE_SERVICES].sort()).toEqual(
        Object.values(RESTARTABLE_COMPONENTS).sort(),
      );
      expect(componentKeyForService('supabase-rest')).toBe('postgrest');
      expect(componentKeyForService('worker')).toBe('worker');
    });

    it('throws for a service off the list: its callers hold the list, so a miss is a bug', () => {
      for (const service of ['db', 'api', '']) {
        expect(() => componentKeyForService(service)).toThrow(/not a restartable service/);
      }
    });
  });

  describe('getDiskUsage', () => {
    it('returns parsed disk usage from the ops-runner', async () => {
      const fetchImpl = (async () =>
        new Response(
          JSON.stringify({
            generatedAt: 'now',
            filesystem: '/dev/sda1',
            mountpoint: '/srv/myclash',
            sizeBytes: 50000000000,
            usedBytes: 32000000000,
            availBytes: 18000000000,
            usePercent: 65,
          }),
          { status: 200 },
        )) as unknown as typeof fetch;
      const service = makeService(fetchImpl);

      const result = await service.getDiskUsage();

      expect(result.usePercent).toBe(65);
      expect(result.mountpoint).toBe('/srv/myclash');
    });

    it('throws ServiceUnavailable when ops-runner is not configured', async () => {
      const service = new AdminSystemActionsService(supabaseStub as never, {
        opsRunnerUrl: '',
        opsRunnerSecret: '',
      });
      await expect(service.getDiskUsage()).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
