#!/usr/bin/env node
/**
 * scripts/create-demo-org.mjs
 *
 * Provisions the E2E sandbox organization and its organizer OWNER account.
 * Idempotent: safe to run on every deploy. If the account or org already
 * exists, the password is synced and the owner membership is (re)asserted.
 *
 * The E2E suite (playwright.e2e.config.ts + tests/e2e/global-setup.ts) assumes
 * this org already exists — it resolves it read-only by slug and logs in as the
 * admin account, but never creates either. This script is the missing
 * provisioning step that makes the .env.e2e values "just work".
 *
 * The owner is a PLAIN organizer (organization_members role 'owner'), NOT a
 * super-admin: super-admins are barred from org membership in the API
 * (assertNotSuperAdmin), so we intentionally do NOT touch platform_roles.
 *
 * Reads from environment variables (injected by deploy.sh via .env + .env.e2e):
 *   SUPABASE_URL              - Supabase/GoTrue URL (internal Docker network)
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key (bypasses RLS)
 *   DATABASE_URL              - Postgres connection string
 *   E2E_ADMIN_EMAIL           - Email for the demo org owner
 *   E2E_ADMIN_PASSWORD        - Password for the demo org owner
 *   E2E_ORG_SLUG              - Slug of the demo org
 *   DEMO_ORG_NAME             - Org display name (default 'test ai org')
 *
 * Outputs JSON to stdout (never the password):
 *   { "userCreated": true|false, "passwordSynced": true|false,
 *     "passwordVerified": true|false, "orgCreated": true|false,
 *     "membershipSynced": true|false, "userId": "...", "orgId": "...",
 *     "email": "...", "slug": "..." }
 *
 * Exit codes:
 *   0 - success
 *   1 - fatal error
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGotrueClient, createRunSql } from './bootstrap-super-admin.mjs';

function fail(message, detail) {
  const error = new Error(message);
  error.detail = detail;
  throw error;
}

function requiredEnv(env) {
  const SUPABASE_URL = env['SUPABASE_URL'];
  const SERVICE_ROLE_KEY = env['SUPABASE_SERVICE_ROLE_KEY'];
  const DATABASE_URL = env['DATABASE_URL'];
  const EMAIL = env['E2E_ADMIN_EMAIL'];
  const PASSWORD = env['E2E_ADMIN_PASSWORD'];
  const SLUG = env['E2E_ORG_SLUG'];
  const NAME = env['DEMO_ORG_NAME'] || 'test ai org';

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !DATABASE_URL || !EMAIL || !PASSWORD || !SLUG) {
    fail(
      'Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_ORG_SLUG',
    );
  }

  return { SUPABASE_URL, SERVICE_ROLE_KEY, DATABASE_URL, EMAIL, PASSWORD, SLUG, NAME };
}

export async function createDemoOrg({
  env = process.env,
  gotrue: gotrueOverride,
  runSql: runSqlOverride,
} = {}) {
  const { SUPABASE_URL, SERVICE_ROLE_KEY, DATABASE_URL, EMAIL, PASSWORD, SLUG, NAME } =
    requiredEnv(env);
  const gotrue =
    gotrueOverride ??
    createGotrueClient({ supabaseUrl: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY });
  const runSql = runSqlOverride ?? createRunSql({ databaseUrl: DATABASE_URL });

  // ── 1. Ensure the GoTrue user (create or sync password) ──────────
  const listRes = await gotrue('GET', '/admin/users?page=1&per_page=1000');
  if (!listRes.ok) {
    fail('Failed to list users', listRes.data);
  }

  const users = listRes.data?.users ?? [];
  const existing = users.find((u) => u.email?.toLowerCase() === EMAIL.toLowerCase());

  let userId;
  let userCreated = false;

  if (existing) {
    userId = existing.id;
    const updateRes = await gotrue('PUT', `/admin/users/${encodeURIComponent(userId)}`, {
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: 'E2E Organizer' },
    });

    if (!updateRes.ok) {
      fail('Failed to sync demo owner password', updateRes.data);
    }
  } else {
    const createRes = await gotrue('POST', '/admin/users', {
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: 'E2E Organizer' },
    });

    if (!createRes.ok) {
      fail('Failed to create demo owner user', createRes.data);
    }

    userId = createRes.data?.id;
    if (!userId) {
      fail('No user ID returned from GoTrue', createRes.data);
    }

    userCreated = true;
  }

  // ── 2. Verify the password actually logs in ──────────────────────
  const verifyRes = await gotrue('POST', '/token?grant_type=password', {
    email: EMAIL,
    password: PASSWORD,
  });
  if (!verifyRes.ok) {
    fail('Failed to verify demo owner password', verifyRes.data);
  }

  // ── 3. SELECT-or-INSERT the org (status 'active' — CHECK allows
  //       only 'active'/'suspended'). No platform_roles: the owner is
  //       a plain organizer, not a super-admin. ──────────────────────
  const [existingOrg] = await runSql(`SELECT id FROM organizations WHERE slug = $1`, [SLUG]);

  let orgId;
  let orgCreated = false;
  if (existingOrg) {
    orgId = existingOrg.id;
  } else {
    const [newOrg] = await runSql(
      `INSERT INTO organizations (name, slug, status, created_by_user_id)
       VALUES ($1, $2, 'active', $3)
       RETURNING id`,
      [NAME, SLUG, userId],
    );
    orgId = newOrg.id;
    orgCreated = true;
  }

  // ── 4. Owner membership (idempotent) ─────────────────────────────
  await runSql(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1, $2, 'owner')
     ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [orgId, userId],
  );

  return {
    userCreated,
    passwordSynced: true,
    passwordVerified: true,
    orgCreated,
    membershipSynced: true,
    userId,
    orgId,
    email: EMAIL,
    slug: SLUG,
  };
}

async function main() {
  const result = await createDemoOrg();
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
