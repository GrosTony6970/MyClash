import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { realtimeEdgeErrors } from './realtime-edge-probe.mjs';

/** An edge that answers each path with a fixed status, and records every request. */
function edge(statusByPath) {
  const sent = [];
  const send = async (options) => {
    sent.push(options);
    return { statusCode: statusByPath[options.path] ?? null, headers: {}, body: '' };
  };
  return { sent, send };
}

const PING = '/realtime/v1/api/ping';
const TENANTS = '/realtime/v1/api/tenants';

test('a healthy edge: ping 200 and tenant management 404 give no error', async () => {
  const { send } = edge({ [PING]: 200, [TENANTS]: 404 });
  assert.deepEqual(await realtimeEdgeErrors('myclash.fr', send), []);
});

test('both probes run on app.<domain> with no token, whatever the environment holds', async () => {
  // The keys are SET: a token sent "when the key is there" must fail here, not hide.
  const names = ['SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const saved = names.map((n) => process.env[n]);
  for (const n of names) process.env[n] = 'a-key-the-probes-must-not-send';
  try {
    const { sent, send } = edge({ [PING]: 200, [TENANTS]: 404 });
    await realtimeEdgeErrors('myclash.fr', send);
    assert.deepEqual(
      sent.map((o) => [o.protocol, o.host, o.path]),
      [
        ['https:', 'app.myclash.fr', PING],
        ['https:', 'app.myclash.fr', TENANTS],
      ],
    );
    for (const o of sent) assert.equal(o.headers, undefined);
  } finally {
    names.forEach((n, i) => {
      if (saved[i] === undefined) delete process.env[n];
      else process.env[n] = saved[i];
    });
  }
});

test('a tenant the edge cannot resolve (ping 401) is an error that says websockets are dead', async () => {
  const { send } = edge({ [PING]: 401, [TENANTS]: 404 });
  const errors = await realtimeEdgeErrors('myclash.fr', send);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /api\/ping returned 401 \(expected 200\).*websockets are dead/);
});

test('an edge that forwards tenant management is an error', async () => {
  for (const status of [200, 401, 403]) {
    const { send } = edge({ [PING]: 200, [TENANTS]: status });
    const errors = await realtimeEdgeErrors('myclash.fr', send);
    assert.equal(errors.length, 1, `tenants ${status}`);
    assert.match(errors[0], new RegExp(`api/tenants returned ${status} \\(expected 404\\)`));
  }
});

test('an edge that does not answer fails both probes', async () => {
  const { send } = edge({});
  const errors = await realtimeEdgeErrors('myclash.fr', send);
  assert.equal(errors.length, 2);
  for (const e of errors) assert.match(e, /returned no response/);
});

test('check-edge-tls.mjs runs the probes for the app host and keeps their errors', async () => {
  // These tests prove the module; this one proves the edge review still runs it, with no key.
  const root = path.join(import.meta.dirname, '..', '..');
  const script = await readFile(path.join(root, 'scripts/check-edge-tls.mjs'), 'utf8');
  assert.ok(script.includes('errors.push(...(await realtimeEdgeErrors(domain, request)));'));
  assert.doesNotMatch(script, /SUPABASE_ANON_KEY/);
});
