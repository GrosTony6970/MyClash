import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  realtimeServiceFindings,
  restoreGuardFindings,
  startScriptFindings,
} from './realtime-tenant-review.mjs';

const root = path.join(import.meta.dirname, '..', '..');
const read = (p) => readFile(path.join(root, p), 'utf8');

// The same top-level service split check-infra-review.mjs uses (two-space service keys).
function services(text) {
  const result = new Map();
  let name = null;
  for (const line of text.split(/\r?\n/u)) {
    const m = /^ {2}([a-zA-Z0-9_-]+):\s*$/u.exec(line);
    if (m) {
      name = m[1];
      result.set(name, line);
    } else if (/^(networks|volumes):\s*$/u.test(line)) {
      name = null;
    } else if (name) {
      result.set(name, `${result.get(name)}\n${line}`);
    }
  }
  return result;
}

const prod = await read('infra/docker-compose.prod.yml');
const dev = await read('infra/docker-compose.dev.yml');
const script = await read('infra/realtime/start.sh');

/** Findings for the prod compose after one text replacement, which must land. */
function prodWith(from, to, { file = prod } = {}) {
  assert.ok(file.includes(from), `the break must land: ${from}`);
  return realtimeServiceFindings({
    label: 'prod',
    services: services(file.replace(from, () => to)),
  });
}
function scriptWith(from, to) {
  assert.ok(script.includes(from), `the break must land: ${from}`);
  return startScriptFindings(script.replace(from, () => to));
}

test('infra:review calls every check and keeps its findings', async () => {
  // These tests prove the module; this one proves the gate still runs it.
  const gate = await read('scripts/check-infra-review.mjs');
  for (const call of [
    "realtimeServiceFindings({ label: 'infra/docker-compose.prod.yml', services })",
    "realtimeServiceFindings({ label: 'infra/docker-compose.dev.yml', services: devServices })",
    'startScriptFindings(startScriptText)',
    'restoreGuardFindings(restoreText)',
    'errors.push(...findings)',
  ]) {
    assert.ok(gate.includes(call), call);
  }
});

test('the real compose files and start script hold every property', () => {
  assert.deepEqual(realtimeServiceFindings({ label: 'prod', services: services(prod) }), []);
  assert.deepEqual(realtimeServiceFindings({ label: 'dev', services: services(dev) }), []);
  assert.deepEqual(startScriptFindings(script), []);
});

test('the seed back on is a finding', () => {
  assert.match(
    prodWith("SEED_SELF_HOST: 'false'", "SEED_SELF_HOST: 'true'").join(),
    /SEED_SELF_HOST/u,
  );
});

test('the management secret shared with anything else is a finding', () => {
  // The shared JWT secret, which signs the public anon key.
  assert.match(
    prodWith(
      'API_JWT_SECRET: ${SUPABASE_REALTIME_API_SECRET:?',
      'API_JWT_SECRET: ${SUPABASE_JWT_SECRET:?',
    ).join(),
    /Realtime's alone/u,
  );
  // A NEW service handed the same variable.
  assert.match(
    prodWith(
      '  supabase-realtime:\n',
      '  newcomer:\n    environment:\n      X: ${SUPABASE_REALTIME_API_SECRET}\n  supabase-realtime:\n',
    ).join(),
    /also in: newcomer/u,
  );
});

test("a socket secret that is not GoTrue's is a finding, fallback text included", () => {
  assert.match(
    prodWith(
      'MYCLASH_REALTIME_SOCKET_SECRET: ${SUPABASE_JWT_SECRET}',
      'MYCLASH_REALTIME_SOCKET_SECRET: ${MYCLASH_GUEST_JWT_SECRET}',
    ).join(),
    /GOTRUE_JWT_SECRET/u,
  );
  const devBroken = dev.replace(
    'GOTRUE_JWT_SECRET: ${SUPABASE_JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}',
    () =>
      'GOTRUE_JWT_SECRET: ${SUPABASE_JWT_SECRET:-another-dev-fallback-with-at-least-32-characters}',
  );
  assert.notEqual(devBroken, dev);
  assert.match(
    realtimeServiceFindings({ label: 'dev', services: services(devBroken) }).join(),
    /GOTRUE_JWT_SECRET/u,
  );
});

test("dev's desk fallback is not dev's JWT fallback", () => {
  const fallback = (name) =>
    new RegExp(String.raw`${name}: \$\{[A-Z_]+:-([^}]+)\}`, 'u').exec(dev)?.[1];
  const desk = fallback('API_JWT_SECRET');
  const jwt = fallback('GOTRUE_JWT_SECRET');
  assert.ok(desk && jwt);
  assert.notEqual(desk, jwt);
});

test('the dead JWT_SECRET line coming back is a finding', () => {
  assert.match(
    prodWith(
      '      METRICS_JWT_SECRET:',
      '      JWT_SECRET: ${SUPABASE_JWT_SECRET}\n      METRICS_JWT_SECRET:',
    ).join(),
    /ruling 508/u,
  );
});

test('a start that skips our script, traces it, or drops the command is a finding', () => {
  assert.match(
    prodWith("'/bin/bash', '/myclash", "'/bin/bash', '-x', '/myclash").join(),
    /must start through/u,
  );
  assert.match(
    prodWith("    command: ['/app/bin/server']\n", '').join(),
    /clears the image's command/u,
  );
  assert.match(
    prodWith('          create_host_path: false', '          create_host_path: true').join(),
    /empty directory/u,
  );
  assert.match(prodWith('        read_only: true\n', '').join(), /empty directory/u);
});

test('a healthcheck with a token, without the tenant Host, or elsewhere is a finding', () => {
  assert.match(
    prodWith(
      '-H "Host: app" http',
      '-H "Authorization: Bearer ${SUPABASE_ANON_KEY}" -H "Host: app" http',
    ).join(),
    /healthcheck/u,
  );
  assert.match(prodWith('-H "Host: app" http', '-H "Host: realtime" http').join(), /healthcheck/u);
  assert.match(
    prodWith('localhost:4000/api/ping', 'localhost:4000/api/tenants/app/health').join(),
    /healthcheck/u,
  );
});

test('a new image tag trips the re-check', () => {
  assert.match(
    prodWith('image: supabase/realtime:v2.124.1', 'image: supabase/realtime:v2.125.0').join(),
    /Re-check infra\/realtime\/start\.sh/u,
  );
});

test('tracing in any shape is a finding', () => {
  for (const [from, to] of [
    ['set -euo pipefail', 'set -euxo pipefail'],
    ['set -euo pipefail', 'set -euo pipefail\nset -o xtrace'],
    ['set -euo pipefail', 'set -euo pipefail\nset -x'],
    ['#!/bin/bash', '#!/bin/bash -x'],
    ['set -euo pipefail', 'set -euo pipefail -x'],
    ['set -euo pipefail', 'set -eu -x -o pipefail'],
    ['set -euo pipefail', 'set -o errexit -o xtrace'],
  ]) {
    assert.match(scriptWith(from, to).join(), /tracing/u, to);
  }
});

test('a secret on a command line is a finding', () => {
  for (const [from, to] of [
    // The token in a header flag instead of the config pipe.
    [
      `-K <(printf 'header = "Authorization: Bearer %s"\\n' "$token")`,
      '-H "Authorization: Bearer $token"',
    ],
    // The body (it holds the database password) as an argument.
    ['--data-binary @-', '--data-binary "$body"'],
    // A secret read by the shell into the eval argument.
    ['System.fetch_env!("API_JWT_SECRET")', '"$API_JWT_SECRET"'],
    // The password handed to jq as an argument.
    ['jq -n ', 'jq -n --arg p "$DB_PASSWORD" '],
  ]) {
    assert.ok(scriptWith(from, to).length > 0, to);
  }
});

test('restore.sh resolves the compose file before its first stop', async () => {
  const restore = await read('infra/scripts/restore.sh');
  assert.deepEqual(restoreGuardFindings(restore), []);
  const guard = '"${COMPOSE[@]}" config --quiet ||';
  assert.ok(restore.includes(guard));
  // Removed, or moved below the first stop.
  assert.equal(restoreGuardFindings(restore.replace(guard, () => 'true ||')).length, 1);
  const moved = `${restore.replace(guard, () => 'true ||')}\n${guard} {\n  exit 1\n}\n`;
  assert.ok(moved.indexOf(guard) > moved.indexOf('"${COMPOSE[@]}" stop'));
  assert.equal(restoreGuardFindings(moved).length, 1);
  // A guard that only warns, or one inside a comment, stops nothing.
  assert.ok(restore.includes('  exit 1\n}\n\nif [[ "$STORAGE_ONLY"'));
  const warnsOnly = restore.replace(
    '  exit 1\n}\n\nif [[ "$STORAGE_ONLY"',
    () => '}\n\nif [[ "$STORAGE_ONLY"',
  );
  assert.equal(restoreGuardFindings(warnsOnly).length, 1);
  const commented = restore.replace(guard, () => `# ${guard}`);
  assert.equal(restoreGuardFindings(commented).length, 1);
});

test('the tenant body and path stay what sockets need', () => {
  assert.match(
    scriptWith(
      'jwt_secret: env.MYCLASH_REALTIME_SOCKET_SECRET',
      'jwt_secret: env.API_JWT_SECRET',
    ).join(),
    /socket secret/u,
  );
  assert.match(
    scriptWith('/api/tenants/$SELF_HOST_TENANT_NAME"', '/api/tenants/realtime"').join(),
    /tenant the sockets/u,
  );
  assert.match(scriptWith('/app/run.sh "$@" &', '/app/bin/server &').join(), /entrypoint script/u);
});
