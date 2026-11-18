import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { bootstrapOpsAgent } from './bootstrap-ops-agent.mjs';

const KEY = `mca_${'k'.repeat(43)}`;
const NEW_KEY = `mca_${'n'.repeat(43)}`;
const sha = (raw) => createHash('sha256').update(raw).digest('hex');

const baseEnv = {
  SUPABASE_URL: 'http://supabase-auth:9999',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  DATABASE_URL: 'postgres://postgres:secret@db:5432/myclash',
  DOMAIN: 'example.test',
  OPS_AGENT_KEY: KEY,
};

const REVOKE_ALL =
  /^UPDATE agent_keys SET revoked_at = now\(\) WHERE revoked_at IS NULL RETURNING id$/;
const REVOKE_OTHERS =
  /^UPDATE agent_keys SET revoked_at = now\(\)\s+WHERE revoked_at IS NULL AND token_hash <> \$1/;

/** A SQL double: records statements; answers from `state`. */
function makeSql(state = {}) {
  const calls = [];
  const runSql = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT id FROM auth.users')) {
      return state.accountId ? [{ id: state.accountId }] : [];
    }
    if (sql.startsWith('INSERT INTO agent_keys'))
      return state.inserted === 0 ? [] : [{ id: 'k-new' }];
    if (sql.startsWith('SELECT revoked_at')) return [{ revoked_at: state.storedRevokedAt ?? null }];
    if (sql.startsWith('UPDATE agent_keys')) return state.liveRows ?? [];
    return [];
  };
  runSql.calls = calls;
  runSql.find = (pattern) => calls.find((c) => pattern.test(c.sql));
  return runSql;
}

/** A GoTrue double; records every call. */
function makeGotrue({ down = false } = {}) {
  const calls = [];
  const gotrue = async (method, path, body) => {
    calls.push({ method, path, body });
    if (down) throw new Error('fetch failed: connect ECONNREFUSED');
    if (method === 'POST' && path === '/admin/users')
      return { ok: true, data: { id: 'agent-new' } };
    if (method === 'PUT') return { ok: true, data: {} };
    throw new Error(`unexpected GoTrue call ${method} ${path}`);
  };
  gotrue.calls = calls;
  return gotrue;
}

test('an empty or unset key revokes every live key, without asking GoTrue', async () => {
  for (const value of [undefined, '']) {
    const runSql = makeSql({ liveRows: [{ id: 'k1' }] });
    const gotrue = makeGotrue({ down: true });
    const result = await bootstrapOpsAgent({
      env: { ...baseEnv, OPS_AGENT_KEY: value },
      gotrue,
      runSql,
    });
    assert.equal(result.state, 'not-configured');
    assert.equal(result.revokedOthers, 1);
    assert.equal(gotrue.calls.length, 0);
    assert.equal(runSql.calls.length, 1);
    assert.match(runSql.calls[0].sql, REVOKE_ALL);
  }
});

test('a value that is not an mca_ key fails, and revokes every live key', async () => {
  const runSql = makeSql({ liveRows: [{ id: 'k1' }] });
  const gotrue = makeGotrue();
  const result = await bootstrapOpsAgent({
    env: { ...baseEnv, OPS_AGENT_KEY: `"${KEY}"` },
    gotrue,
    runSql,
  });
  assert.equal(result.state, 'failed');
  assert.equal(result.revokedOthers, 1);
  assert.equal(runSql.calls.length, 1);
  assert.match(runSql.calls[0].sql, REVOKE_ALL);
  assert.equal(gotrue.calls.length, 0);
});

test('first run: other keys revoked first, then a banned account with no password, then the hash', async () => {
  const runSql = makeSql();
  const gotrue = makeGotrue();
  const result = await bootstrapOpsAgent({ env: baseEnv, gotrue, runSql });

  assert.match(runSql.calls[0].sql, REVOKE_OTHERS);
  assert.deepEqual(runSql.calls[0].params, [sha(KEY)]);
  assert.deepEqual(runSql.find(/^SELECT id FROM auth.users/).params, ['ops-agent@example.test']);

  const create = gotrue.calls.find((c) => c.method === 'POST');
  assert.equal(create.path, '/admin/users');
  assert.equal(create.body.email, 'ops-agent@example.test');
  assert.equal(create.body.email_confirm, true);
  assert.equal('password' in create.body, false);
  assert.equal(create.body.user_metadata.display_name, 'Claude (ops agent)');
  assert.deepEqual(
    gotrue.calls.find((c) => c.method === 'PUT'),
    {
      method: 'PUT',
      path: '/admin/users/agent-new',
      body: { ban_duration: '876000h' },
    },
  );

  const insert = runSql.find(/^INSERT INTO agent_keys/);
  assert.match(insert.sql, /ON CONFLICT \(token_hash\) DO NOTHING/);
  assert.deepEqual(insert.params, ['agent-new', sha(KEY), 'Claude ops agent']);
  assert.equal(result.state, 'created');
});

test('the same key again: the account found by SQL, the ban sent again, nothing un-revoked', async () => {
  const runSql = makeSql({ accountId: 'agent-1', inserted: 0 });
  const gotrue = makeGotrue();
  const result = await bootstrapOpsAgent({ env: baseEnv, gotrue, runSql });

  assert.equal(gotrue.calls.filter((c) => c.method === 'POST').length, 0);
  assert.equal(gotrue.calls.filter((c) => c.method === 'GET').length, 0);
  assert.deepEqual(gotrue.calls.find((c) => c.method === 'PUT').path, '/admin/users/agent-1');
  for (const { sql } of runSql.calls) {
    assert.doesNotMatch(sql, /revoked_at\s*=\s*NULL/i);
    assert.doesNotMatch(sql, /DO UPDATE/i);
  }
  assert.equal(result.state, 'existing');
});

test('a key revoked on the console stays revoked, and says so', async () => {
  const runSql = makeSql({
    accountId: 'agent-1',
    inserted: 0,
    storedRevokedAt: '2026-11-18T11:00:00Z',
  });
  const result = await bootstrapOpsAgent({ env: baseEnv, gotrue: makeGotrue(), runSql });
  assert.equal(result.state, 'revoked');
});

test('a new key revokes the old live one and stores the new hash', async () => {
  const runSql = makeSql({ accountId: 'agent-1', liveRows: [{ id: 'old' }] });
  const result = await bootstrapOpsAgent({
    env: { ...baseEnv, OPS_AGENT_KEY: NEW_KEY },
    gotrue: makeGotrue(),
    runSql,
  });
  assert.equal(result.state, 'created');
  assert.equal(result.revokedOthers, 1);
  assert.deepEqual(runSql.calls[0].params, [sha(NEW_KEY)]);
  assert.equal(runSql.find(/^INSERT INTO agent_keys/).params[1], sha(NEW_KEY));
});

test('GoTrue down with a NEW key: the old key is revoked anyway, and nothing is stored', async () => {
  const runSql = makeSql({ liveRows: [{ id: 'old' }] });
  const result = await bootstrapOpsAgent({
    env: { ...baseEnv, OPS_AGENT_KEY: NEW_KEY },
    gotrue: makeGotrue({ down: true }),
    runSql,
  });
  assert.equal(result.state, 'failed');
  assert.match(runSql.calls[0].sql, REVOKE_OTHERS);
  assert.deepEqual(runSql.calls[0].params, [sha(NEW_KEY)]);
  assert.equal(runSql.find(/^INSERT INTO agent_keys/), undefined);
});

test('GoTrue down with the SAME key: the live key is spared, so an ordinary deploy changes nothing', async () => {
  const runSql = makeSql();
  const result = await bootstrapOpsAgent({
    env: baseEnv,
    gotrue: makeGotrue({ down: true }),
    runSql,
  });
  assert.equal(result.state, 'failed');
  assert.deepEqual(runSql.calls[0].params, [sha(KEY)]);
  assert.equal(runSql.find(/^INSERT INTO agent_keys/), undefined);
});

test('the result never carries the raw key', async () => {
  for (const env of [baseEnv, { ...baseEnv, OPS_AGENT_KEY: `${KEY}x` }]) {
    const result = await bootstrapOpsAgent({
      env,
      gotrue: makeGotrue(),
      runSql: makeSql({ accountId: 'agent-1' }),
    });
    assert.equal(JSON.stringify(result).includes(KEY), false);
  }
});
