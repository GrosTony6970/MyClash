#!/usr/bin/env node
/**
 * scripts/bootstrap-super-admin.mjs
 *
 * Creates the initial super admin account on first deploy.
 * Idempotent — safe to run on every deploy; does nothing if the account
 * already exists.
 *
 * Reads from environment variables (injected by deploy.sh via .env):
 *   SUPABASE_URL              — Supabase/GoTrue URL (internal Docker network)
 *   SUPABASE_SERVICE_ROLE_KEY — Service role key (bypasses RLS)
 *   DATABASE_URL              — Postgres connection string
 *   SEED_ADMIN_EMAIL          — Email for the super admin
 *   SEED_ADMIN_PASSWORD       — Password for the super admin
 *
 * Outputs JSON to stdout:
 *   { "created": true|false, "userId": "...", "email": "..." }
 *
 * Exit codes:
 *   0 — success (created or already existed)
 *   1 — fatal error
 */

import { createHmac } from 'node:crypto';

const SUPABASE_URL = process.env['SUPABASE_URL'];
const SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_EMAIL = process.env['SEED_ADMIN_EMAIL'];
const ADMIN_PASSWORD = process.env['SEED_ADMIN_PASSWORD'];

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !DATABASE_URL || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error(
    JSON.stringify({
      error: 'Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD',
    }),
  );
  process.exit(1);
}

// ── Minimal GoTrue admin API client (no npm deps needed) ──────────────────────

async function gotrue(method, path, body) {
  const url = `${SUPABASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, data: json };
}

// ── Minimal Postgres client (no npm deps — uses node:net + pg wire protocol) ──
// We use the pg module which is available in the API container's node_modules.
// If not available, fall back to a raw SQL approach via psql.

async function runSql(sql, params = []) {
  // Dynamic import of pg — available in the API container
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    await client.end();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Check if user already exists via GoTrue admin list
  const listRes = await gotrue('GET', '/admin/users?page=1&per_page=1000');
  if (!listRes.ok) {
    console.error(JSON.stringify({ error: 'Failed to list users', detail: listRes.data }));
    process.exit(1);
  }

  const users = listRes.data?.users ?? [];
  const existing = users.find(
    (u) => u.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase(),
  );

  let userId;
  let created = false;

  if (existing) {
    userId = existing.id;
  } else {
    // 2. Create the user
    const createRes = await gotrue('POST', '/admin/users', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: 'Super Admin' },
    });

    if (!createRes.ok) {
      console.error(JSON.stringify({ error: 'Failed to create admin user', detail: createRes.data }));
      process.exit(1);
    }

    userId = createRes.data?.id;
    if (!userId) {
      console.error(JSON.stringify({ error: 'No user ID returned from GoTrue', detail: createRes.data }));
      process.exit(1);
    }
    created = true;
  }

  // 3. Ensure platform_roles row exists (idempotent)
  await runSql(
    `INSERT INTO platform_roles (user_id, role)
     VALUES ($1, 'super_admin')
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );

  // 4. Ensure a bootstrap organization exists (idempotent)
  const orgSlug = 'myclash-hq';
  const orgName = 'MyClash HQ';
  const [existingOrg] = await runSql(
    `SELECT id FROM organizations WHERE slug = $1`,
    [orgSlug],
  );

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

  // 5. Ensure org membership (idempotent)
  await runSql(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1, $2, 'owner')
     ON CONFLICT (organization_id, user_id) DO NOTHING`,
    [orgId, userId],
  );

  console.log(JSON.stringify({ created, userId, email: ADMIN_EMAIL, orgId }));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err?.message ?? err) }));
  process.exit(1);
});
