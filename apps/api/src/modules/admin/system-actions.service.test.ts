import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminSystemActionsService } from './system-actions.service';

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
