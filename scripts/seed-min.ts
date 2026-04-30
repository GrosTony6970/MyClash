#!/usr/bin/env tsx
/**
 * scripts/seed-min.ts
 *
 * Minimal seed: creates the bootstrap rows needed to start using MyClash.
 *
 * Creates:
 *   1. A super admin user in Supabase Auth
 *   2. A platform_roles row granting super_admin
 *   3. One organization ("MyClash HQ")
 *   4. One organizer user (the super admin is also the org owner)
 *
 * Usage:
 *   pnpm seed:min
 *
 * Environment variables (from .env):
 *   DATABASE_URL          — Postgres connection string
 *   SUPABASE_URL          — Supabase/Kong URL
 *   SUPABASE_SERVICE_ROLE_KEY — Service role key (bypasses RLS)
 *   SEED_ADMIN_EMAIL      — Email for the super admin (default: admin@myclash.fr)
 *   SEED_ADMIN_PASSWORD   — Password for the super admin (default: ChangeMe123!)
 *   SEED_ORG_NAME         — Org name (default: MyClash HQ)
 *   SEED_ORG_SLUG         — Org slug (default: myclash-hq)
 *
 * Idempotent: running twice produces no duplicates and no errors.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

// ── Config ────────────────────────────────────────────────────────────────────

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:dev-password@localhost:5432/myclash';

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://localhost:8000';

const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';

const ADMIN_EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@myclash.fr';

const ADMIN_PASSWORD = process.env['SEED_ADMIN_PASSWORD'] ?? 'ChangeMe123!';

const ORG_NAME = process.env['SEED_ORG_NAME'] ?? 'MyClash HQ';

const ORG_SLUG = process.env['SEED_ORG_SLUG'] ?? 'myclash-hq';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ok = (m: string) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const warn = (m: string) => console.log(`\x1b[33m!\x1b[0m ${m}`);
const hdr = (m: string) => console.log(`\n\x1b[36m\x1b[1m── ${m} ──\x1b[0m`);

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  hdr('MyClash minimal seed');

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error('✗ SUPABASE_SERVICE_ROLE_KEY is required');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const sql = postgres(DATABASE_URL, { max: 1 });

  try {
    // ── 1. Super admin user ─────────────────────────────────────────────────
    hdr('Super admin user');

    // Check if user already exists
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(
      (u) => u.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase(),
    );

    let adminUserId: string;

    if (existingUser) {
      adminUserId = existingUser.id;
      warn(`User already exists: ${ADMIN_EMAIL} (${adminUserId})`);
    } else {
      const { data: newUser, error } = await supabase.auth.admin.createUser({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: 'Super Admin' },
      });

      if (error || !newUser.user) {
        throw new Error(`Failed to create admin user: ${error?.message}`);
      }

      adminUserId = newUser.user.id;
      ok(`Created admin user: ${ADMIN_EMAIL} (${adminUserId})`);
    }

    // ── 2. Platform role (super_admin) ──────────────────────────────────────
    hdr('Platform role');

    await sql`
      INSERT INTO platform_roles (user_id, role)
      VALUES (${adminUserId}, 'super_admin')
      ON CONFLICT (user_id) DO NOTHING
    `;
    ok(`platform_roles: super_admin for ${adminUserId}`);

    // ── 3. Organization ─────────────────────────────────────────────────────
    hdr('Organization');

    const [existingOrg] = await sql<Array<{ id: string }>>`
      SELECT id FROM organizations WHERE slug = ${ORG_SLUG}
    `;

    let orgId: string;

    if (existingOrg) {
      orgId = existingOrg.id;
      warn(`Organization already exists: ${ORG_SLUG} (${orgId})`);
    } else {
      const [newOrg] = await sql<Array<{ id: string }>>`
        INSERT INTO organizations (name, slug, status, created_by_user_id)
        VALUES (${ORG_NAME}, ${ORG_SLUG}, 'active', ${adminUserId})
        RETURNING id
      `;
      orgId = newOrg!.id;
      ok(`Created organization: ${ORG_NAME} / ${ORG_SLUG} (${orgId})`);
    }

    // ── 4. Organization membership (owner) ──────────────────────────────────
    hdr('Organization membership');

    await sql`
      INSERT INTO organization_members (organization_id, user_id, role)
      VALUES (${orgId}, ${adminUserId}, 'owner')
      ON CONFLICT (organization_id, user_id) DO NOTHING
    `;
    ok(`organization_members: ${adminUserId} is owner of ${ORG_SLUG}`);

    // ── Summary ─────────────────────────────────────────────────────────────
    hdr('Seed complete');
    console.log();
    console.log('  Super admin:');
    console.log(`    Email:    ${ADMIN_EMAIL}`);
    console.log(`    Password: ${ADMIN_PASSWORD}`);
    console.log(`    User ID:  ${adminUserId}`);
    console.log();
    console.log('  Organization:');
    console.log(`    Name:  ${ORG_NAME}`);
    console.log(`    Slug:  ${ORG_SLUG}`);
    console.log(`    ID:    ${orgId}`);
    console.log();
    warn('Change the admin password before going to production!');
    console.log();
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error('\x1b[31m✗\x1b[0m Seed failed:', e);
  process.exit(1);
});
