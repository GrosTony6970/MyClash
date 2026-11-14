import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as Sentry from '@sentry/nestjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initApiSentry } from './sentry';

/**
 * On the wire, through the real SDK: the API's outgoing requests carry Sentry's
 * trace headers to our own hosts only. One local server is reached under two
 * names: `localhost` is ours (SUPABASE_URL names it), `127.0.0.1` stands for an
 * outside service such as an AI provider. Without tracePropagationTargets the
 * SDK sends the headers to both.
 */
describe('API Sentry trace headers, on the wire', () => {
  let server: Server;
  let port = 0;
  const received = new Map<string, string | undefined>();
  const baggage = new Map<string, string | undefined>();

  beforeAll(async () => {
    server = createServer((req, res) => {
      received.set(req.url ?? '', req.headers['sentry-trace'] as string | undefined);
      baggage.set(req.url ?? '', req.headers['baggage'] as string | undefined);
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
    initApiSentry({
      SENTRY_DSN_API: 'http://k@127.0.0.1:9/1',
      SUPABASE_URL: `http://localhost:${port}`,
    });
  });

  afterAll(async () => {
    await Sentry.close(0);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('sends them to our own host and to no other', async () => {
    await Sentry.startSpan({ name: 'probe' }, async () => {
      await (await fetch(`http://localhost:${port}/own`)).text();
      await (await fetch(`http://127.0.0.1:${port}/outside`)).text();
    });
    expect(received.has('/own') && received.has('/outside')).toBe(true);
    expect(received.get('/own')).toMatch(/^[0-9a-f]{32}-[0-9a-f]{16}/u);
    expect(received.get('/outside')).toBeUndefined();
    // baggage names our release and environment: it stays home too.
    expect(baggage.get('/own')).toMatch(/sentry-trace_id=/u);
    expect(baggage.get('/outside')).toBeUndefined();
  });
});
