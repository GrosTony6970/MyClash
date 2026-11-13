#!/usr/bin/env node
/**
 * scripts/install-e2e-ai-key.mjs
 *
 * Installs the E2E AI key (E2E_AI_PROVIDER + E2E_AI_KEY) as the ACTIVE key in
 * two slots: the platform slot (signed in as the E2E super admin) and the E2E
 * sandbox org's slot (signed in as that org's organiser). Each slot is written
 * through the running API, so the key store stays the only code that encrypts
 * a key or switches the active one.
 *
 * Idempotent: a key labelled LABEL is updated in place, not added again.
 * Activating it switches OFF any other key active in the same slot.
 *
 * Signs in at GoTrue directly, not through /auth/password-login: that route is
 * throttled per email and the e2e suite needs the budget.
 *
 * Reads from environment variables (injected by deploy.sh via .env + .env.e2e):
 *   SUPABASE_URL              - GoTrue URL (internal Docker network)
 *   SUPABASE_SERVICE_ROLE_KEY - GoTrue apikey
 *   API_URL                   - API base incl. /api/v1 (internal Docker network)
 *   E2E_AI_PROVIDER           - anthropic | openai | mistral | google
 *   E2E_AI_KEY                - the provider's secret
 *   E2E_AI_MODEL              - optional; blank = the provider's default model
 *   E2E_AI_BUDGET_EUR         - optional monthly ceiling per key; blank = 1.00
 *   E2E_SUPERADMIN_EMAIL / E2E_SUPERADMIN_PASSWORD - platform slot
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD / E2E_ORG_SLUG - org slot
 *
 * Outputs JSON to stdout (never a secret):
 *   { "platform": { "keyId", "created" }, "org": { "keyId", "created", "orgId" } }
 *
 * Exit codes: 0 success, 1 fatal error.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGotrueClient } from './bootstrap-super-admin.mjs';

export const LABEL = 'E2E key (deploy)';

function fail(message, detail) {
  const error = new Error(message);
  error.detail = detail;
  throw error;
}

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'API_URL',
  'E2E_AI_PROVIDER',
  'E2E_AI_KEY',
  'E2E_SUPERADMIN_EMAIL',
  'E2E_SUPERADMIN_PASSWORD',
  'E2E_ADMIN_EMAIL',
  'E2E_ADMIN_PASSWORD',
  'E2E_ORG_SLUG',
];

function readEnv(env) {
  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length > 0) fail(`Missing required env vars: ${missing.join(', ')}`);
  const budget = env['E2E_AI_BUDGET_EUR']?.trim();
  const monthlyBudgetEur = budget ? Number(budget) : 1;
  if (!Number.isFinite(monthlyBudgetEur) || monthlyBudgetEur < 0) {
    fail(`E2E_AI_BUDGET_EUR is not a non-negative number: "${budget}"`);
  }
  return {
    key: {
      provider: env['E2E_AI_PROVIDER'].trim().toLowerCase(),
      apiKey: env['E2E_AI_KEY'].trim(),
      model: env['E2E_AI_MODEL']?.trim() || null,
      monthlyBudgetEur,
    },
    apiUrl: env['API_URL'].replace(/\/+$/, ''),
  };
}

async function signIn(gotrue, email, password) {
  const res = await gotrue('POST', '/token?grant_type=password', { email, password });
  if (!res.ok || !res.data?.access_token) fail(`Sign-in failed for ${email}`, res.data);
  return res.data.access_token;
}

function createApiClient({ apiUrl, token, fetchImpl }) {
  return async function api(method, requestPath, body) {
    const res = await fetchImpl(`${apiUrl}/${requestPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) fail(`${method} ${requestPath} answered ${res.status}`, data);
    return data;
  };
}

/** Creates or updates the LABEL key in `scope`, then makes it the active one. */
async function installInScope(api, scope, key) {
  const keys = await api('GET', scope);
  const existing = keys.find((k) => k.label === LABEL);
  const installed = existing
    ? await api('PATCH', `${scope}/${existing.id}`, key)
    : await api('POST', scope, { label: LABEL, ...key, isActive: true });
  await api('POST', `${scope}/${installed.id}/activate`);
  return { keyId: installed.id, created: !existing };
}

export async function installE2eAiKey({
  env = process.env,
  gotrue: gotrueOverride,
  fetchImpl = fetch,
} = {}) {
  const { key, apiUrl } = readEnv(env);
  const gotrue =
    gotrueOverride ??
    createGotrueClient({
      supabaseUrl: env['SUPABASE_URL'],
      serviceRoleKey: env['SUPABASE_SERVICE_ROLE_KEY'],
    });
  const clientFor = async (email, password) =>
    createApiClient({ apiUrl, token: await signIn(gotrue, email, password), fetchImpl });

  const superAdmin = await clientFor(env['E2E_SUPERADMIN_EMAIL'], env['E2E_SUPERADMIN_PASSWORD']);
  const platform = await installInScope(superAdmin, 'admin/ai-keys', key);

  const organiser = await clientFor(env['E2E_ADMIN_EMAIL'], env['E2E_ADMIN_PASSWORD']);
  const org = await organiser(
    'GET',
    `organizations/slug/${encodeURIComponent(env['E2E_ORG_SLUG'])}`,
  );
  const orgKey = await installInScope(organiser, `organizations/${org.id}/ai-keys`, key);

  return { platform, org: { ...orgKey, orgId: org.id } };
}

async function main() {
  const result = await installE2eAiKey();
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
