#!/usr/bin/env node
/**
 * scripts/bootstrap-ops-agent.mjs
 *
 * Seeds the ops agent's account and key from the VPS `.env` on every deploy (the ops agent's
 * design, docs/superpowers/specs/2026-11-18-ops-agent-design.md, section 1). A wipe empties the
 * key table, so the deploy, not a person, puts the key back.
 *
 * What dies never waits for GoTrue: turning the agent off, or replacing a leaked key, must work
 * while the login service is down.
 *
 *   OPS_AGENT_KEY empty or unset  → every live key is revoked (the off switch).
 *   OPS_AGENT_KEY not an mca_ key → every live key is revoked, and the state is `failed`: a typo
 *                                   must not leave the key it was meant to replace alive.
 *   OPS_AGENT_KEY set             → first, every live key with another hash is revoked; then the
 *                                   account `ops-agent@${DOMAIN}` is found by SQL or created
 *                                   through GoTrue with no password, banned again (so nobody signs
 *                                   in as it, even after a ban lifted on the console), and the
 *                                   key's sha256 is stored.
 *
 * A key revoked on the console is never revived: the insert does nothing on a known hash, and the
 * result says `revoked` so the deploy can ask for a new value.
 *
 * Reads: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, DOMAIN, OPS_AGENT_KEY.
 * Prints one JSON line: { state, revokedOthers, error? }. Never the key. revokedOthers is null
 * when the revoke never ran (the database could not be reached).
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

const REVOKE_ALL_SQL =
  'UPDATE agent_keys SET revoked_at = now() WHERE revoked_at IS NULL RETURNING id';
const REVOKE_OTHERS_SQL = `UPDATE agent_keys SET revoked_at = now()
  WHERE revoked_at IS NULL AND token_hash <> $1
  RETURNING id`;
const INSERT_KEY_SQL = `INSERT INTO agent_keys (user_id, token_hash, label) VALUES ($1, $2, $3)
  ON CONFLICT (token_hash) DO NOTHING
  RETURNING id`;

class SeedError extends Error {}

function hashKey(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

/** The account by SQL (no paged GoTrue list), created through GoTrue when absent, then banned. */
async function ensureAccount(gotrue, runSql, email) {
  const [found] = await runSql('SELECT id FROM auth.users WHERE lower(email) = $1', [email]);
  let userId = found?.id;
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

async function seed(env, gotrueOverride, runSqlOverride, progress) {
  const key = env['OPS_AGENT_KEY'] ?? '';
  const databaseUrl = env['DATABASE_URL'];
  if (!databaseUrl) throw new SeedError('Missing DATABASE_URL');
  const runSql = runSqlOverride ?? createRunSql({ databaseUrl });

  if (key === '' || !OPS_AGENT_KEY_PATTERN.test(key)) {
    progress.revokedOthers = (await runSql(REVOKE_ALL_SQL)).length;
    if (key === '') return { state: 'not-configured', revokedOthers: progress.revokedOthers };
    throw new SeedError('OPS_AGENT_KEY is not an mca_ key (mca_ and 43 base64url characters)');
  }

  const hash = hashKey(key);
  progress.revokedOthers = (await runSql(REVOKE_OTHERS_SQL, [hash])).length;

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DOMAIN } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DOMAIN) {
    throw new SeedError('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or DOMAIN');
  }
  const gotrue =
    gotrueOverride ??
    createGotrueClient({ supabaseUrl: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });
  const userId = await ensureAccount(gotrue, runSql, `ops-agent@${DOMAIN}`.toLowerCase());

  const inserted = await runSql(INSERT_KEY_SQL, [userId, hash, KEY_LABEL]);
  const [row] = await runSql('SELECT revoked_at FROM agent_keys WHERE token_hash = $1', [hash]);
  const state = row?.revoked_at ? 'revoked' : inserted.length > 0 ? 'created' : 'existing';
  return { state, revokedOthers: progress.revokedOthers };
}

export async function bootstrapOpsAgent({ env = process.env, gotrue, runSql } = {}) {
  // null until the revoke has run: a failure before it must not read as "0 revoked" (the
  // restore's lib, infra/scripts/lib/ops-agent-seed.sh, prints an error line on null).
  const progress = { revokedOthers: null };
  try {
    return await seed(env, gotrue, runSql, progress);
  } catch (err) {
    // A GoTrue or database message, never the key: the key is only ever hashed.
    return {
      state: 'failed',
      revokedOthers: progress.revokedOthers,
      error: String(err?.message ?? err),
    };
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
