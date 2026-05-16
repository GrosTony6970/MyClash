import assert from 'node:assert/strict';
import test from 'node:test';

import { bootstrapSuperAdmin } from './bootstrap-super-admin.mjs';

const baseEnv = {
  SUPABASE_URL: 'http://supabase-auth:9999',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  DATABASE_URL: 'postgres://postgres:secret@db:5432/myclash',
  SEED_ADMIN_EMAIL: 'admin@myclash.fr',
  SEED_ADMIN_PASSWORD: 'super-secret-password',
};

function makeSqlMock() {
  const calls = [];
  const runSql = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT id FROM organizations')) {
      return [{ id: 'org-existing' }];
    }
    if (sql.includes('RETURNING id')) {
      return [{ id: 'org-created' }];
    }
    return [];
  };
  runSql.calls = calls;
  return runSql;
}

test('syncs password for an existing super admin user', async () => {
  const gotrueCalls = [];
  const gotrue = async (method, path, body) => {
    gotrueCalls.push({ method, path, body });
    if (method === 'GET') {
      return {
        ok: true,
        data: { users: [{ id: 'user-existing', email: 'admin@myclash.fr' }] },
      };
    }
    if (method === 'PUT' && path === '/admin/users/user-existing') {
      return { ok: true, data: { id: 'user-existing' } };
    }
    throw new Error(`Unexpected GoTrue call: ${method} ${path}`);
  };
  const runSql = makeSqlMock();

  const result = await bootstrapSuperAdmin({ env: baseEnv, gotrue, runSql });

  assert.deepEqual(result, {
    created: false,
    passwordSynced: true,
    roleSynced: true,
    orgMembershipSynced: true,
    userId: 'user-existing',
    email: 'admin@myclash.fr',
    orgId: 'org-existing',
  });
  assert.deepEqual(gotrueCalls[1], {
    method: 'PUT',
    path: '/admin/users/user-existing',
    body: {
      password: 'super-secret-password',
      email_confirm: true,
      user_metadata: { display_name: 'Super Admin' },
    },
  });
  assert.equal(runSql.calls.length, 3);
  assert.match(runSql.calls[0].sql, /ON CONFLICT \(user_id\) DO UPDATE SET role = EXCLUDED\.role/);
  assert.match(
    runSql.calls[2].sql,
    /ON CONFLICT \(organization_id, user_id\) DO UPDATE SET role = EXCLUDED\.role/,
  );
  assert.equal(JSON.stringify(result).includes('super-secret-password'), false);
});

test('creates the super admin when no user exists', async () => {
  const gotrueCalls = [];
  const gotrue = async (method, path, body) => {
    gotrueCalls.push({ method, path, body });
    if (method === 'GET') {
      return { ok: true, data: { users: [] } };
    }
    if (method === 'POST' && path === '/admin/users') {
      return { ok: true, data: { id: 'user-created' } };
    }
    throw new Error(`Unexpected GoTrue call: ${method} ${path}`);
  };
  const runSql = makeSqlMock();

  const result = await bootstrapSuperAdmin({ env: baseEnv, gotrue, runSql });

  assert.equal(result.created, true);
  assert.equal(result.passwordSynced, true);
  assert.equal(result.userId, 'user-created');
  assert.deepEqual(gotrueCalls[1], {
    method: 'POST',
    path: '/admin/users',
    body: {
      email: 'admin@myclash.fr',
      password: 'super-secret-password',
      email_confirm: true,
      user_metadata: { display_name: 'Super Admin' },
    },
  });
  assert.equal(runSql.calls.length, 3);
  assert.equal(JSON.stringify(result).includes('super-secret-password'), false);
});

test('fails when existing user password sync fails', async () => {
  const gotrue = async (method) => {
    if (method === 'GET') {
      return {
        ok: true,
        data: { users: [{ id: 'user-existing', email: 'admin@myclash.fr' }] },
      };
    }
    return { ok: false, data: { message: 'update failed' } };
  };
  const runSql = makeSqlMock();

  await assert.rejects(
    bootstrapSuperAdmin({ env: baseEnv, gotrue, runSql }),
    /Failed to sync admin user password/,
  );
  assert.equal(runSql.calls.length, 0);
});
