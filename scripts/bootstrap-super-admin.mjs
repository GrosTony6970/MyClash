#!/usr/bin/env node
/**
 * scripts/bootstrap-super-admin.mjs
 *
 * Creates and maintains the initial super admin account.
 * Idempotent: safe to run on every deploy. If the account already exists,
 * its password is synced from SEED_ADMIN_PASSWORD.
 *
 * Reads from environment variables (injected by deploy.sh via .env):
 *   SUPABASE_URL              - Supabase/GoTrue URL (internal Docker network)
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key (bypasses RLS)
 *   DATABASE_URL              - Postgres connection string
 *   SEED_ADMIN_EMAIL          - Email for the super admin
 *   SEED_ADMIN_PASSWORD       - Password for the super admin
 *
 * Outputs JSON to stdout:
 *   { "created": true|false, "passwordSynced": true|false, "userId": "...", "email": "..." }
 *
 * Exit codes:
 *   0 - success
 *   1 - fatal error
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// pg lives in apps/api/node_modules. Resolve it from the API package context
// because Node will not walk into a sibling directory from scripts/.
const require = createRequire('/app/apps/api/package.json');

export function createGotrueClient({ supabaseUrl, serviceRoleKey, fetchImpl = fetch }) {
  return async function gotrue(method, requestPath, body) {
    const res = await fetchImpl(`${supabaseUrl}${requestPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    return { ok: res.ok, status: res.status, data: json };
  };
}

export function createRunSql({ databaseUrl, requireImpl = require }) {
  return async function runSql(sql, params = []) {
    const pg = requireImpl('pg');
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows;
    } finally {
      await client.end();
    }
  };
}

function fail(message, detail) {
  const error = new Error(message);
  error.detail = detail;
  throw error;
}

function requiredEnv(env) {
  const SUPABASE_URL = env['SUPABASE_URL'];
  const SERVICE_ROLE_KEY = env['SUPABASE_SERVICE_ROLE_KEY'];
  const DATABASE_URL = env['DATABASE_URL'];
  const ADMIN_EMAIL = env['SEED_ADMIN_EMAIL'];
  const ADMIN_PASSWORD = env['SEED_ADMIN_PASSWORD'];

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !DATABASE_URL || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    fail(
      'Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD',
    );
  }

  return {
    SUPABASE_URL,
    SERVICE_ROLE_KEY,
    DATABASE_URL,
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
  };
}

export async function bootstrapSuperAdmin({
  env = process.env,
  gotrue: gotrueOverride,
  runSql: runSqlOverride,
} = {}) {
  const { SUPABASE_URL, SERVICE_ROLE_KEY, DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD } =
    requiredEnv(env);
  const gotrue =
    gotrueOverride ??
    createGotrueClient({ supabaseUrl: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY });
  const runSql = runSqlOverride ?? createRunSql({ databaseUrl: DATABASE_URL });

  const listRes = await gotrue('GET', '/admin/users?page=1&per_page=1000');
  if (!listRes.ok) {
    fail('Failed to list users', listRes.data);
  }

  const users = listRes.data?.users ?? [];
  const existing = users.find((u) => u.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase());

  let userId;
  let created = false;
  let passwordSynced = false;

  if (existing) {
    userId = existing.id;
    const updateRes = await gotrue('PUT', `/admin/users/${encodeURIComponent(userId)}`, {
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: 'Super Admin' },
    });

    if (!updateRes.ok) {
      fail('Failed to sync admin user password', updateRes.data);
    }

    passwordSynced = true;
  } else {
    const createRes = await gotrue('POST', '/admin/users', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: 'Super Admin' },
    });

    if (!createRes.ok) {
      fail('Failed to create admin user', createRes.data);
    }

    userId = createRes.data?.id;
    if (!userId) {
      fail('No user ID returned from GoTrue', createRes.data);
    }

    created = true;
    passwordSynced = true;
  }

  await runSql(
    `INSERT INTO platform_roles (user_id, role)
     VALUES ($1, 'super_admin')
     ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role`,
    [userId],
  );

  const orgSlug = 'myclash-hq';
  const orgName = 'MyClash HQ';
  const [existingOrg] = await runSql(`SELECT id FROM organizations WHERE slug = $1`, [orgSlug]);

  let orgId;
  if (existingOrg) {
    orgId = existingOrg.id;
  } else {
    const [newOrg] = await runSql(
      `INSERT INTO organizations (name, slug, status, created_by_user_id)
       VALUES ($1, $2, 'active', $3)
       RETURNING id`,
      [orgName, orgSlug, userId],
    );
    orgId = newOrg.id;
  }

  await runSql(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1, $2, 'owner')
     ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [orgId, userId],
  );

  return {
    created,
    passwordSynced,
    roleSynced: true,
    orgMembershipSynced: true,
    userId,
    email: ADMIN_EMAIL,
    orgId,
  };
}

async function main() {
  const result = await bootstrapSuperAdmin();
  console.log(JSON.stringify(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    const body = { error: String(err?.message ?? err) };
    if (err?.detail !== undefined) body.detail = err.detail;
    console.error(JSON.stringify(body));
    process.exit(1);
  });
}
