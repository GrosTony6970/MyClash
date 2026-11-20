import { EventEmitter } from 'node:events';
import type https from 'node:https';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifiedFetch } from './verified-fetch';

/** A fake `https.request`: records its options and answers `status`, or fails with `error`. */
function fakeRequest(answer: { status?: number; error?: Error } = { status: 200 }) {
  const calls: { url: URL; options: https.RequestOptions; body: unknown }[] = [];
  const request = vi.fn((url: URL, options: https.RequestOptions, onResponse) => {
    const req = new EventEmitter() as EventEmitter & { end: (body?: unknown) => void };
    req.end = (body?: unknown) => {
      calls.push({ url, options, body });
      if (answer.error) {
        queueMicrotask(() => req.emit('error', answer.error));
        return;
      }
      const res = Object.assign(new EventEmitter(), {
        statusCode: answer.status,
        resume() {
          queueMicrotask(() => res.emit('end'));
          return res;
        },
      });
      queueMicrotask(() => (onResponse as (r: unknown) => void)(res));
    };
    return req;
  });
  return { request: request as unknown as typeof https.request, calls };
}

describe('verifiedFetch (ruling 905)', () => {
  afterEach(() => {
    delete process.env['NODE_TLS_REJECT_UNAUTHORIZED'];
  });

  it('checks the certificate even when the environment turns the check off', async () => {
    // --dev-certs layers docker-compose.staging-certs.yml, which sets this on the worker.
    process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
    const { request, calls } = fakeRequest();
    await verifiedFetch(request)('https://api.anthropic.com/v1/x/fire', { method: 'POST' });
    expect(calls[0]!.options.rejectUnauthorized).toBe(true);
  });

  it('sends the method, the headers, the body and the abort signal, and answers the status', async () => {
    const { request, calls } = fakeRequest({ status: 400 });
    const signal = AbortSignal.timeout(15_000);
    const response = await verifiedFetch(request)('https://api.anthropic.com/v1/x/fire', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: '{"text":"alert"}',
      signal,
    });
    expect(response.status).toBe(400);
    expect(response.ok).toBe(false);
    expect(calls[0]!.url.href).toBe('https://api.anthropic.com/v1/x/fire');
    expect(calls[0]!.options).toMatchObject({
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      signal,
    });
    expect(calls[0]!.body).toBe('{"text":"alert"}');
  });

  it('a GET by default, with no body', async () => {
    const { request, calls } = fakeRequest();
    const response = await verifiedFetch(request)('https://hc-ping.com/uuid', {});
    expect(response.ok).toBe(true);
    expect(calls[0]!.options.method).toBe('GET');
    expect(calls[0]!.body).toBeUndefined();
  });

  it('a failed connection rejects, as fetch does', async () => {
    const { request } = fakeRequest({ error: new Error('certificate has expired') });
    await expect(verifiedFetch(request)('https://hc-ping.com/uuid', {})).rejects.toThrow(
      'certificate has expired',
    );
  });

  it('refuses a plain http URL: a token never leaves unencrypted', async () => {
    const { request } = fakeRequest();
    await expect(verifiedFetch(request)('http://example.com/fire', {})).rejects.toThrow(/https/);
    expect(request).not.toHaveBeenCalled();
  });
});
