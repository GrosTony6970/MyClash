import assert from 'node:assert/strict';
import test from 'node:test';

import { createDemoOrg } from './create-demo-org.mjs';

const baseEnv = {
  SUPABASE_URL: 'http://supabase-auth:9999',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  DATABASE_URL: 'postgres://postgres:secret@db:5432/myclash',
  E2E_ADMIN_EMAIL: 'test@test.com',
  E2E_ADMIN_PASSWORD: 'e2e-secret-password',
  E2E_ORG_SLUG: 'test-ai-org',
  DEMO_ORG_NAME: 'test ai org',
};

// SQL mock where the org already exists (SELECT returns a row).
function makeSqlMockOrgExists() {
  const calls = [];
  const runSql = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT id FROM organizations')) {
      return [{ id: 'org-existing' }];
    }
    return [];
  };
  runSql.calls = calls;
  return runSql;
}

// SQL mock where the org must be created (SELECT empty, INSERT RETURNING id).
function makeSqlMockOrgCreated() {
  const calls = [];
  const runSql = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT id FROM organizations')) {
      return [];
    }
    if (sql.includes('RETURNING id')) {
      return [{ id: 'org-created' }];
    }
    return [];
  };
  runSql.calls = calls;
  return runSql;
}

function gotrueExistingUser(calls) {
  return async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET') {
      return { ok: true, data: { users: [{ id: 'user-existing', email: 'test@test.com' }] } };
    }
    if (method === 'PUT' && path === '/admin/users/user-existing') {
      return { ok: true, data: { id: 'user-existing' } };
    }
    if (method === 'POST' && path === '/token?grant_type=password') {
      return { ok: true, data: { access_token: 'verified-token' } };
    }
    throw new Error(`Unexpected GoTrue call: ${method} ${path}`);
  };
}

function gotrueNewUser(calls) {
  return async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET') {
      return { ok: true, data: { users: [] } };
    }
    if (method === 'POST' && path === '/admin/users') {
      return { ok: true, data: { id: 'user-created' } };
    }
    if (method === 'POST' && path === '/token?grant_type=password') {
      return { ok: true, data: { access_token: 'verified-token' } };
    }
    throw new Error(`Unexpected GoTrue call: ${method} ${path}`);
  };
}

test('syncs an existing owner and reuses an existing org', async () => {
  const gotrueCalls = [];
  const gotrue = gotrueExistingUser(gotrueCalls);
  const runSql = makeSqlMockOrgExists();

  const result = await createDemoOrg({ env: baseEnv, gotrue, runSql });

  assert.deepEqual(result, {
    userCreated: false,
    passwordSynced: true,
    passwordVerified: true,
    orgCreated: false,
    membershipSynced: true,
    userId: 'user-existing',
    orgId: 'org-existing',
    email: 'test@test.com',
    slug: 'test-ai-org',
  });

  // Password sync uses email_confirm + an organizer display name.
  assert.deepEqual(gotrueCalls[1], {
    method: 'PUT',
    path: '/admin/users/user-existing',
    body: {
      password: 'e2e-secret-password',
      email_confirm: true,
      user_metadata: { display_name: 'E2E Organizer' },
    },
  });
  // Password login is verified.
  assert.deepEqual(gotrueCalls[2], {
    method: 'POST',
    path: '/token?grant_type=password',
    body: { email: 'test@test.com', password: 'e2e-secret-password' },
  });

  // Existing org → SELECT + owner-membership upsert only (2 calls).
  assert.equal(runSql.calls.length, 2);
  assert.match(runSql.calls[0].sql, /SELECT id FROM organizations WHERE slug = \$1/);
  assert.deepEqual(runSql.calls[0].params, ['test-ai-org']);
  assert.match(
    runSql.calls[1].sql,
    /INSERT INTO organization_members[\s\S]*ON CONFLICT \(organization_id, user_id\) DO UPDATE SET role = EXCLUDED\.role/,
  );
  assert.deepEqual(runSql.calls[1].params, ['org-existing', 'user-existing']);

  // Regression guard: the owner must NOT be a super-admin.
  assert.equal(
    runSql.calls.some((call) => call.sql.includes('platform_roles')),
    false,
    'must never write to platform_roles (owner is a plain organizer)',
  );
  // Never leak the password.
  assert.equal(JSON.stringify(result).includes('e2e-secret-password'), false);
});

test('creates the owner and the org when neither exists', async () => {
  const gotrueCalls = [];
  const gotrue = gotrueNewUser(gotrueCalls);
  const runSql = makeSqlMockOrgCreated();

  const result = await createDemoOrg({ env: baseEnv, gotrue, runSql });

  assert.deepEqual(result, {
    userCreated: true,
    passwordSynced: true,
    passwordVerified: true,
    orgCreated: true,
    membershipSynced: true,
    userId: 'user-created',
    orgId: 'org-created',
    email: 'test@test.com',
    slug: 'test-ai-org',
  });

  assert.deepEqual(gotrueCalls[1], {
    method: 'POST',
    path: '/admin/users',
    body: {
      email: 'test@test.com',
      password: 'e2e-secret-password',
      email_confirm: true,
      user_metadata: { display_name: 'E2E Organizer' },
    },
  });

  // New org → SELECT + INSERT..RETURNING + owner-membership upsert (3 calls).
  assert.equal(runSql.calls.length, 3);
  assert.match(runSql.calls[1].sql, /INSERT INTO organizations[\s\S]*'active'[\s\S]*RETURNING id/);
  assert.deepEqual(runSql.calls[1].params, ['test ai org', 'test-ai-org', 'user-created']);
  assert.match(
    runSql.calls[2].sql,
    /INSERT INTO organization_members[\s\S]*ON CONFLICT \(organization_id, user_id\)/,
  );

  assert.equal(
    runSql.calls.some((call) => call.sql.includes('platform_roles')),
    false,
    'must never write to platform_roles (owner is a plain organizer)',
  );
  assert.equal(JSON.stringify(result).includes('e2e-secret-password'), false);
});

test('defaults the org name to "test ai org" when DEMO_ORG_NAME is unset', async () => {
  const { DEMO_ORG_NAME: _omit, ...envWithoutName } = baseEnv;
  const gotrue = gotrueNewUser([]);
  const runSql = makeSqlMockOrgCreated();

  await createDemoOrg({ env: envWithoutName, gotrue, runSql });

  const insertOrg = runSql.calls.find((c) => c.sql.includes('INSERT INTO organizations'));
  assert.equal(insertOrg.params[0], 'test ai org');
});

test('fails when the required env vars are missing', async () => {
  await assert.rejects(
    createDemoOrg({
      env: { SUPABASE_URL: 'http://x' },
      gotrue: async () => ({}),
      runSql: async () => [],
    }),
    /Missing required env vars/,
  );
});

test('fails when the owner password cannot be verified', async () => {
  const gotrue = async (method, path) => {
    if (method === 'GET') {
      return { ok: true, data: { users: [{ id: 'user-existing', email: 'test@test.com' }] } };
    }
    if (method === 'PUT' && path === '/admin/users/user-existing') {
      return { ok: true, data: { id: 'user-existing' } };
    }
    if (method === 'POST' && path === '/token?grant_type=password') {
      return { ok: false, data: { message: 'Invalid login credentials' } };
    }
    throw new Error(`Unexpected GoTrue call: ${method} ${path}`);
  };
  const runSql = makeSqlMockOrgExists();

  await assert.rejects(
    createDemoOrg({ env: baseEnv, gotrue, runSql }),
    /Failed to verify demo owner password/,
  );
  // Verification happens before any DB write.
  assert.equal(runSql.calls.length, 0);
});
