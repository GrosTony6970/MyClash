import assert from 'node:assert/strict';
import test from 'node:test';

import { LABEL, installE2eAiKey } from './install-e2e-ai-key.mjs';

const baseEnv = {
  SUPABASE_URL: 'http://supabase-auth:9999',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  API_URL: 'http://api:4000/api/v1/',
  E2E_AI_PROVIDER: 'Anthropic',
  E2E_AI_KEY: 'sk-ant-test-key-0000',
  E2E_AI_MODEL: '',
  E2E_AI_BUDGET_EUR: '',
  E2E_SUPERADMIN_EMAIL: 'super@test.com',
  E2E_SUPERADMIN_PASSWORD: 'super-password',
  E2E_ADMIN_EMAIL: 'organiser@test.com',
  E2E_ADMIN_PASSWORD: 'organiser-password',
  E2E_ORG_SLUG: 'test-ai-org',
};

const tokens = { 'super@test.com': 'token-super', 'organiser@test.com': 'token-organiser' };

function makeGotrue() {
  return async (method, requestPath, body) => {
    assert.equal(method, 'POST');
    assert.equal(requestPath, '/token?grant_type=password');
    const token = tokens[body.email];
    return token
      ? { ok: true, status: 200, data: { access_token: token } }
      : { ok: false, status: 400, data: {} };
  };
}

/** A fake API holding one key list per scope. `existing` seeds those lists. */
function makeApi(existing = {}) {
  const lists = { 'admin/ai-keys': [], 'organizations/org-1/ai-keys': [], ...existing };
  const calls = [];
  const fetchImpl = async (url, init) => {
    const requestPath = url.replace('http://api:4000/api/v1/', '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, requestPath, token: init.headers.Authorization, body });
    const reply = (status, data) => ({
      ok: status < 400,
      status,
      text: async () => JSON.stringify(data),
    });

    if (requestPath === 'organizations/slug/test-ai-org') return reply(200, { id: 'org-1' });
    const scope = Object.keys(lists).find(
      (s) => requestPath === s || requestPath.startsWith(`${s}/`),
    );
    if (!scope) return reply(404, { detail: 'no route' });
    if (init.method === 'GET') return reply(200, lists[scope]);
    if (init.method === 'POST' && requestPath === scope) {
      const created = { id: scope === 'admin/ai-keys' ? 'new-p' : 'new-o', ...body };
      lists[scope].push(created);
      return reply(201, created);
    }
    if (init.method === 'PATCH') return reply(200, { id: requestPath.split('/').pop(), ...body });
    if (init.method === 'POST' && requestPath.endsWith('/activate')) return reply(200, {});
    return reply(405, {});
  };
  return { fetchImpl, calls };
}

test('creates and activates the key in the platform and org slots, each with its own login', async () => {
  const { fetchImpl, calls } = makeApi();
  const result = await installE2eAiKey({ env: baseEnv, gotrue: makeGotrue(), fetchImpl });

  assert.deepEqual(result, {
    platform: { keyId: 'new-p', created: true },
    org: { keyId: 'new-o', created: true, orgId: 'org-1' },
  });

  const expectedKey = {
    label: LABEL,
    provider: 'anthropic',
    apiKey: 'sk-ant-test-key-0000',
    model: null,
    monthlyBudgetEur: 1,
    isActive: true,
  };
  const platformCreate = calls.find(
    (c) => c.method === 'POST' && c.requestPath === 'admin/ai-keys',
  );
  assert.deepEqual(platformCreate.body, expectedKey);
  assert.equal(platformCreate.token, 'Bearer token-super');

  const orgCreate = calls.find(
    (c) => c.method === 'POST' && c.requestPath === 'organizations/org-1/ai-keys',
  );
  assert.deepEqual(orgCreate.body, expectedKey);
  assert.equal(orgCreate.token, 'Bearer token-organiser');

  for (const activate of [
    'admin/ai-keys/new-p/activate',
    'organizations/org-1/ai-keys/new-o/activate',
  ]) {
    assert.ok(
      calls.some((c) => c.method === 'POST' && c.requestPath === activate),
      `missing ${activate}`,
    );
  }
});

test('updates the labelled key in place on a re-run instead of adding a second one', async () => {
  const { fetchImpl, calls } = makeApi({
    'admin/ai-keys': [
      { id: 'other', label: 'Real key' },
      { id: 'p-1', label: LABEL },
    ],
    'organizations/org-1/ai-keys': [{ id: 'o-1', label: LABEL }],
  });
  const env = { ...baseEnv, E2E_AI_MODEL: 'claude-haiku-4-5', E2E_AI_BUDGET_EUR: '5' };
  const result = await installE2eAiKey({ env, gotrue: makeGotrue(), fetchImpl });

  assert.deepEqual(result.platform, { keyId: 'p-1', created: false });
  assert.deepEqual(result.org, { keyId: 'o-1', created: false, orgId: 'org-1' });
  assert.ok(!calls.some((c) => c.method === 'POST' && c.requestPath.endsWith('ai-keys')));

  const patch = calls.find((c) => c.method === 'PATCH' && c.requestPath === 'admin/ai-keys/p-1');
  assert.deepEqual(patch.body, {
    provider: 'anthropic',
    apiKey: 'sk-ant-test-key-0000',
    model: 'claude-haiku-4-5',
    monthlyBudgetEur: 5,
  });
  assert.ok(calls.some((c) => c.requestPath === 'admin/ai-keys/p-1/activate'));
  assert.ok(calls.some((c) => c.requestPath === 'organizations/org-1/ai-keys/o-1/activate'));
});

test('names every missing variable and calls nothing', async () => {
  const { fetchImpl, calls } = makeApi();
  const env = { ...baseEnv, E2E_AI_KEY: '', E2E_SUPERADMIN_PASSWORD: ' ' };
  await assert.rejects(installE2eAiKey({ env, gotrue: makeGotrue(), fetchImpl }), {
    message: 'Missing required env vars: E2E_AI_KEY, E2E_SUPERADMIN_PASSWORD',
  });
  assert.equal(calls.length, 0);
});

test('a refused sign-in stops before any key is written', async () => {
  const { fetchImpl, calls } = makeApi();
  const env = { ...baseEnv, E2E_SUPERADMIN_EMAIL: 'unknown@test.com' };
  await assert.rejects(installE2eAiKey({ env, gotrue: makeGotrue(), fetchImpl }), {
    message: 'Sign-in failed for unknown@test.com',
  });
  assert.equal(calls.length, 0);
});

test('an API refusal surfaces its status and body', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 403,
    text: async () => JSON.stringify({ detail: 'Forbidden' }),
  });
  await assert.rejects(
    installE2eAiKey({ env: baseEnv, gotrue: makeGotrue(), fetchImpl }),
    (err) => {
      assert.equal(err.message, 'GET admin/ai-keys answered 403');
      assert.deepEqual(err.detail, { detail: 'Forbidden' });
      return true;
    },
  );
});
