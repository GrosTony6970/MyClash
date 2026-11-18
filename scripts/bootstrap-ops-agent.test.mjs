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

/** A SQL double: records statements; answers the CTE and the revoked_at read from `state`. */
function makeSql(state = {}) {
  const calls = [];
  const runSql = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('WITH revoked')) {
      return [{ revoked_others: state.revokedOthers ?? 0, inserted: state.inserted ?? 1 }];
    }
    if (sql.includes('SELECT revoked_at')) return [{ revoked_at: state.storedRevokedAt ?? null }];
    if (sql.startsWith('UPDATE agent_keys')) return state.liveRows ?? [];
    return [];
  };
  runSql.calls = calls;
  return runSql;
}

/** A GoTrue double: `existing` is the agent account if it exists; records every call. */
function makeGotrue({ existing = null, down = false } = {}) {
  const calls = [];
  const gotrue = async (method, path, body) => {
    calls.push({ method, path, body });
    if (down) throw new Error('fetch failed: connect ECONNREFUSED');
    if (method === 'GET') return { ok: true, data: { users: existing ? [existing] : [] } };
    if (method === 'POST' && path === '/admin/users')
      return { ok: true, data: { id: 'agent-new' } };
    if (method === 'PUT') return { ok: true, data: {} };
    throw new Error(`unexpected GoTrue call ${method} ${path}`);
  };
  gotrue.calls = calls;
  return gotrue;
}

const ACCOUNT = { id: 'agent-1', email: 'ops-agent@example.test' };

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
    assert.match(
      runSql.calls[0].sql,
      /^UPDATE agent_keys SET revoked_at = now\(\) WHERE revoked_at IS NULL/,
    );
  }
});

test('a key that is not an mca_ key fails, and touches nothing', async () => {
  const runSql = makeSql();
  const gotrue = makeGotrue();
  const result = await bootstrapOpsAgent({
    env: { ...baseEnv, OPS_AGENT_KEY: 'not-a-key' },
    gotrue,
    runSql,
  });
  assert.equal(result.state, 'failed');
  assert.equal(runSql.calls.length, 0);
  assert.equal(gotrue.calls.length, 0);
});

test('first run: creates a banned account with no password, then stores the hash', async () => {
  const runSql = makeSql({ inserted: 1 });
  const gotrue = makeGotrue();
  const result = await bootstrapOpsAgent({ env: baseEnv, gotrue, runSql });

  const create = gotrue.calls.find((c) => c.method === 'POST');
  assert.equal(create.path, '/admin/users');
  assert.equal(create.body.email, 'ops-agent@example.test');
  assert.equal(create.body.email_confirm, true);
  assert.equal('password' in create.body, false);
  assert.equal(create.body.user_metadata.display_name, 'Claude (ops agent)');

  const ban = gotrue.calls.find((c) => c.method === 'PUT');
  assert.equal(ban.path, '/admin/users/agent-new');
  assert.deepEqual(ban.body, { ban_duration: '876000h' });

  const cte = runSql.calls.find((c) => c.sql.includes('WITH revoked'));
  assert.match(cte.sql, /token_hash <> \$2 AND revoked_at IS NULL/);
  assert.match(cte.sql, /ON CONFLICT \(token_hash\) DO NOTHING/);
  assert.deepEqual(cte.params, ['agent-new', sha(KEY), 'Claude ops agent']);
  assert.equal(result.state, 'created');
});

test('the same key again: no new account, the ban sent again, nothing un-revoked', async () => {
  const runSql = makeSql({ inserted: 0 });
  const gotrue = makeGotrue({ existing: ACCOUNT });
  const result = await bootstrapOpsAgent({ env: baseEnv, gotrue, runSql });

  assert.equal(gotrue.calls.filter((c) => c.method === 'POST').length, 0);
  assert.deepEqual(
    gotrue.calls.find((c) => c.method === 'PUT'),
    { method: 'PUT', path: '/admin/users/agent-1', body: { ban_duration: '876000h' } },
  );
  for (const { sql } of runSql.calls) {
    assert.doesNotMatch(sql, /revoked_at\s*=\s*NULL/i);
    assert.doesNotMatch(sql, /DO UPDATE/i);
  }
  assert.equal(result.state, 'existing');
});

test('a key revoked on the console stays revoked, and says so', async () => {
  const runSql = makeSql({ inserted: 0, storedRevokedAt: '2026-11-18T11:00:00Z' });
  const result = await bootstrapOpsAgent({
    env: baseEnv,
    gotrue: makeGotrue({ existing: ACCOUNT }),
    runSql,
  });
  assert.equal(result.state, 'revoked');
});

test('a new key revokes the old live one and stores the new hash', async () => {
  const runSql = makeSql({ inserted: 1, revokedOthers: 1 });
  const result = await bootstrapOpsAgent({
    env: { ...baseEnv, OPS_AGENT_KEY: NEW_KEY },
    gotrue: makeGotrue({ existing: ACCOUNT }),
    runSql,
  });
  assert.equal(result.state, 'created');
  assert.equal(result.revokedOthers, 1);
  assert.equal(runSql.calls.find((c) => c.sql.includes('WITH revoked')).params[1], sha(NEW_KEY));
});

test('GoTrue down with a key set: fails, and writes nothing', async () => {
  const runSql = makeSql();
  const result = await bootstrapOpsAgent({
    env: baseEnv,
    gotrue: makeGotrue({ down: true }),
    runSql,
  });
  assert.equal(result.state, 'failed');
  assert.equal(runSql.calls.length, 0);
});

test('the result never carries the raw key', async () => {
  for (const env of [baseEnv, { ...baseEnv, OPS_AGENT_KEY: `${KEY}x` }]) {
    const result = await bootstrapOpsAgent({
      env,
      gotrue: makeGotrue({ existing: ACCOUNT }),
      runSql: makeSql(),
    });
    assert.equal(JSON.stringify(result).includes(KEY), false);
  }
});
