#!/usr/bin/env node
/**
 * scripts/bootstrap-ops-agent.mjs
 *
 * Seeds the ops agent's account and key from the VPS `.env` on every deploy (the ops agent's
 * design, docs/superpowers/specs/2026-11-18-ops-agent-design.md, section 1). A wipe empties the
 * key table, so the deploy, not a person, puts the key back.
 *
 *   OPS_AGENT_KEY empty or unset → every live key is revoked (the off switch). No GoTrue call:
 *                                  turning the agent off must work while the login service is down.
 *   OPS_AGENT_KEY not an mca_ key → failed; nothing is touched.
 *   OPS_AGENT_KEY set             → the account `ops-agent@${DOMAIN}` exists (created with no
 *                                  password), is banned again (so nobody signs in as it, even after
 *                                  a ban lifted on the console), and the key's sha256 is stored. Any
 *                                  other live key of the account is revoked in the same statement.
 *
 * A key revoked on the console is never revived: the insert does nothing on a known hash, and the
 * result says `revoked` so the deploy can ask for a new value.
 *
 * Reads: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, DOMAIN, OPS_AGENT_KEY.
 * Prints one JSON line: { state, revokedOthers, error? }. Never the key.
 *   state: not-configured | created | existing | revoked | failed
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGotrueClient, createRunSql } from './bootstrap-super-admin.mjs';

export const OPS_AGENT_KEY_PATTERN = /^mca_[A-Za-z0-9_-]{43}$/;
const DISPLAY_NAME = 'Claude (ops agent)';
const KEY_LABEL = 'Claude ops agent';
const BAN = { ban_duration: '876000h' };

const STORE_KEY_SQL = `WITH revoked AS (
  UPDATE agent_keys SET revoked_at = now()
  WHERE user_id = $1 AND token_hash <> $2 AND revoked_at IS NULL
  RETURNING id
), inserted AS (
  INSERT INTO agent_keys (user_id, label, token_hash) VALUES ($1, $3, $2)
  ON CONFLICT (token_hash) DO NOTHING
  RETURNING id
)
SELECT (SELECT count(*) FROM revoked)::int AS revoked_others,
       (SELECT count(*) FROM inserted)::int AS inserted`;

class SeedError extends Error {}

function hashKey(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

async function ensureAccount(gotrue, email) {
  const list = await gotrue('GET', '/admin/users?page=1&per_page=1000');
  if (!list.ok) throw new SeedError('Failed to list users');
  const existing = (list.data?.users ?? []).find((u) => u.email?.toLowerCase() === email);
  let userId = existing?.id;
  if (!userId) {
    const created = await gotrue('POST', '/admin/users', {
      email,
      email_confirm: true,
      user_metadata: { display_name: DISPLAY_NAME },
    });
    userId = created.ok ? created.data?.id : undefined;
    if (!userId) throw new SeedError('Failed to create the ops agent account');
  }
  const ban = await gotrue('PUT', `/admin/users/${encodeURIComponent(userId)}`, BAN);
  if (!ban.ok) throw new SeedError('Failed to ban sign-in for the ops agent account');
  return userId;
}

async function seed(env, gotrueOverride, runSqlOverride) {
  const key = env['OPS_AGENT_KEY'] ?? '';
  const databaseUrl = env['DATABASE_URL'];
  if (!databaseUrl) throw new SeedError('Missing DATABASE_URL');
  const runSql = runSqlOverride ?? createRunSql({ databaseUrl });

  if (key === '') {
    const revoked = await runSql(
      'UPDATE agent_keys SET revoked_at = now() WHERE revoked_at IS NULL RETURNING id',
    );
    return { state: 'not-configured', revokedOthers: revoked.length };
  }
  if (!OPS_AGENT_KEY_PATTERN.test(key)) {
    throw new SeedError('OPS_AGENT_KEY is not an mca_ key (mca_ and 43 base64url characters)');
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DOMAIN } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DOMAIN) {
    throw new SeedError('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or DOMAIN');
  }
  const gotrue =
    gotrueOverride ??
    createGotrueClient({ supabaseUrl: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });
  const userId = await ensureAccount(gotrue, `ops-agent@${DOMAIN}`.toLowerCase());

  const hash = hashKey(key);
  const [stored] = await runSql(STORE_KEY_SQL, [userId, hash, KEY_LABEL]);
  // A second statement: the CTE's own snapshot cannot see the row it inserted.
  const [row] = await runSql('SELECT revoked_at FROM agent_keys WHERE token_hash = $1', [hash]);
  const state = row?.revoked_at ? 'revoked' : stored?.inserted > 0 ? 'created' : 'existing';
  return { state, revokedOthers: stored?.revoked_others ?? 0 };
}

export async function bootstrapOpsAgent({ env = process.env, gotrue, runSql } = {}) {
  try {
    return await seed(env, gotrue, runSql);
  } catch (err) {
    // A GoTrue or database message, never the key: the key is only ever hashed.
    return { state: 'failed', revokedOthers: 0, error: String(err?.message ?? err) };
  }
}

async function main() {
  const result = await bootstrapOpsAgent();
  console.log(JSON.stringify(result));
  if (result.state === 'failed') process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
