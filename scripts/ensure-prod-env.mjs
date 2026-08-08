#!/usr/bin/env node
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureVapidEnv } from './ensure-vapid-env.mjs';

const SAMPLE_VALUES = new Map([
  ['DOMAIN', new Set(['yourdomain.com'])],
  ['LETSENCRYPT_EMAIL', new Set(['webmaster@example.com'])],
  ['TRAEFIK_DASHBOARD_AUTH', new Set(['admin:$$2y$$05$$changeme'])],
  // No sample value — the example ships it empty. Present only so the pair below
  // is declared in one place with its hash.
  ['TRAEFIK_DASHBOARD_PASSWORD', new Set([''])],
  ['STUDIO_BASIC_AUTH', new Set(['admin:$$2y$$05$$changeme'])],
  ['STUDIO_PASSWORD', new Set([''])],
  ['COOKIE_SECRET', new Set(['change-me-cookie-secret'])],
  ['SUPABASE_URL', new Set(['http://localhost:8000'])],
  ['POSTGRES_PASSWORD', new Set(['change-me-strong-password', 'dev-password'])],
  [
    'SUPABASE_JWT_SECRET',
    new Set([
      'super-secret-jwt-token-with-at-least-32-characters-long',
      'dev-jwt-secret-change-me',
    ]),
  ],
  [
    'SUPABASE_REALTIME_SECRET',
    new Set(['a-very-long-secret-key-base-for-realtime-at-least-64-chars-long-here']),
  ],
  ['SUPABASE_REALTIME_DB_ENC_KEY', new Set(['change-me-realtime-db-enc-key'])],
  ['SUPABASE_ANON_KEY', new Set(['change-me-anon-jwt'])],
  ['SUPABASE_SERVICE_ROLE_KEY', new Set(['change-me-service-role-jwt'])],
  ['MYCLASH_GUEST_JWT_SECRET', new Set(['change-me-guest-jwt-secret'])],
  ['MYCLASH_STAFF_JWT_SECRET', new Set(['change-me-staff-jwt-secret'])],
  ['OPS_RUNNER_SECRET', new Set(['change-me-ops-runner-secret'])],
  ['RESEND_API_KEY', new Set(['re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'])],
  ['MAIL_FROM', new Set(['noreply@yourdomain.com'])],
  ['NEXT_PUBLIC_SUPABASE_URL', new Set(['http://localhost:8000'])],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', new Set(['change-me-anon-jwt'])],
  // Per-app API URLs (admin/public/scoring each route differently in prod).
  // The deploy script writes derived values into .env from ${DOMAIN};
  // docker-compose then reads each per-service.
  ['NEXT_PUBLIC_API_URL_ADMIN', new Set(['http://localhost:4000'])],
  ['NEXT_PUBLIC_API_URL_PUBLIC', new Set(['http://localhost:4000'])],
  ['NEXT_PUBLIC_API_URL_STAFF', new Set(['http://localhost:4000'])],
  // Cross-app deep links baked into admin + scoring at build time.
  ['NEXT_PUBLIC_STAFF_URL', new Set(['http://localhost:3002'])],
  ['NEXT_PUBLIC_PUBLIC_APP_URL', new Set(['http://localhost:3001'])],
  // Marketing origin — hosts the terms + privacy policy the apps link to.
  ['NEXT_PUBLIC_MARKETING_URL', new Set(['https://myclash.localhost'])],
  ['SEED_ADMIN_PASSWORD', new Set(['change-me-admin-password'])],
  ['SEED_ADMIN_EMAIL', new Set(['admin@yourdomain.com', ''])],
  // Scaleway S3 backup — no sample values, just detect empty
  ['BACKUP_SCW_ACCESS_KEY', new Set([''])],
  ['BACKUP_SCW_SECRET_KEY', new Set([''])],
  ['BACKUP_SCW_BUCKET', new Set([''])],
  ['SENTRY_DSN_API', new Set([''])],
  ['NEXT_PUBLIC_SENTRY_DSN_ADMIN', new Set([''])],
  ['NEXT_PUBLIC_SENTRY_DSN_PUBLIC', new Set([''])],
  ['NEXT_PUBLIC_SENTRY_DSN_SCORING', new Set([''])],
  ['SENTRY_RELEASE', new Set([''])],
  ['NEXT_PUBLIC_SENTRY_RELEASE', new Set([''])],
  ['AI_KEY_SECRET', new Set([''])],
]);

const SECRET_GENERATORS = {
  POSTGRES_PASSWORD: () => randomBytes(32).toString('base64url'),
  COOKIE_SECRET: () => randomBytes(32).toString('hex'),
  SUPABASE_JWT_SECRET: () => randomBytes(48).toString('base64url'),
  SUPABASE_REALTIME_SECRET: () => randomBytes(64).toString('base64url'),
  SUPABASE_REALTIME_DB_ENC_KEY: () => randomBytes(12).toString('base64url'),
  MYCLASH_GUEST_JWT_SECRET: () => randomBytes(48).toString('base64url'),
  MYCLASH_STAFF_JWT_SECRET: () => randomBytes(48).toString('base64url'),
  OPS_RUNNER_SECRET: () => randomBytes(48).toString('base64url'),
  AI_KEY_SECRET: () => randomBytes(32).toString('hex'),
  // Generate a strong random password for the bootstrap super admin.
  // Stored in .env so deploy.sh can display it once and the operator saves it.
  SEED_ADMIN_PASSWORD: () => randomBytes(16).toString('base64url'),
};

const HUMAN_REQUIRED = [
  'DOMAIN',
  'LETSENCRYPT_EMAIL',
  'RESEND_API_KEY',
  'MAIL_FROM',
  'SMTP_PASS',
  'SEED_ADMIN_EMAIL',
  'BACKUP_SCW_ACCESS_KEY',
  'BACKUP_SCW_SECRET_KEY',
  'BACKUP_SCW_BUCKET',
];

// Every basic-auth surface the edge gates. Each is a HASH + PLAINTEXT pair in
// .env: Traefik reads the hash, the operator (and, for the dashboard, the edge
// probe) reads the plaintext. Adding a surface here is the whole wiring —
// generation, staleness and regeneration all iterate this list.
//
// {SHA} rather than bcrypt on purpose: Compose interpolates docker labels, so a
// bcrypt hash would need every `$` doubled. Base64 SHA-1 contains no `$` and
// reaches Traefik byte-for-byte. The htpasswd `$$2y$$` sample values below are
// only ever placeholders — nothing generates bcrypt.
const BASIC_AUTH_PAIRS = [
  {
    service: 'TRAEFIK_DASHBOARD',
    username: 'admin',
    authKey: 'TRAEFIK_DASHBOARD_AUTH',
    passwordKey: 'TRAEFIK_DASHBOARD_PASSWORD',
  },
  {
    service: 'STUDIO',
    username: 'admin',
    authKey: 'STUDIO_BASIC_AUTH',
    passwordKey: 'STUDIO_PASSWORD',
  },
];

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signSupabaseJwt(role, secret) {
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64urlJson({ role, iat: 1_613_531_985, exp: 4_769_205_985 });
  const data = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

function generateBasicAuth({ service, username }) {
  const password = randomBytes(18).toString('base64url');
  const hash = createHash('sha1').update(password).digest('base64');
  return {
    envValue: `${username}:{SHA}${hash}`,
    credential: { service, username, password },
  };
}

export function parseEnv(content) {
  const values = new Map();
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match?.[1]) values.set(match[1], stripQuotes(match[2] ?? ''));
  }
  return values;
}

function stripQuotes(value) {
  return value.trim().replace(/^["']|["']$/g, '');
}

function isSampleOrMissing(key, value) {
  const trimmed = stripQuotes(value ?? '');
  if (!trimmed) return true;
  if (key === 'SUPABASE_REALTIME_DB_ENC_KEY' && Buffer.byteLength(trimmed, 'utf8') !== 16) {
    return true;
  }
  const samples = SAMPLE_VALUES.get(key);
  return samples?.has(trimmed) ?? false;
}

function setEnvValue(content, key, value) {
  const lines = content.split(/\r?\n/);
  let found = false;
  const updated = lines.map((line) => {
    if (line.match(new RegExp(`^\\s*${key}=`))) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!found) {
    if (updated.length > 0 && updated.at(-1) !== '') updated.push('');
    updated.push(`${key}=${value}`);
  }

  return updated.join('\n');
}

function applyValue(state, key, value, changeType) {
  state.content = setEnvValue(state.content, key, value);
  state.values.set(key, value);
  if (changeType) state[changeType].push(key);
}

async function askValue(key, currentValue, rl, options) {
  const inputValue = options.answers?.[key];
  if (inputValue !== undefined) return inputValue;
  if (options.nonInteractive) {
    throw new Error(
      currentValue
        ? `${key} is set to a sample value ("${currentValue}"). Update .env with the real value.`
        : `${key} is required but missing from .env.`,
    );
  }

  const hint = currentValue ? 'sample value detected' : 'required';
  const answer = await rl.question(`  ${key} (${hint}): `);
  if (!answer.trim()) {
    throw new Error(`${key} is required.`);
  }
  return answer.trim();
}

async function ensureEnvFile(envPath, examplePath) {
  if (existsSync(envPath)) return false;
  if (!existsSync(examplePath)) {
    throw new Error(`Missing ${envPath} and template ${examplePath}`);
  }
  await copyFile(examplePath, envPath);
  return true;
}

/**
 * The htpasswd hash is derived from the plaintext, so the two keys are one
 * value in two forms and must be written in the same pass. Regenerating when
 * EITHER is sample-or-missing is what keeps them from drifting into a dashboard
 * nobody can open: an .env carrying a real hash but no plaintext (every .env
 * written before this key existed) gets one rotation, printed by deploy.sh's
 * Deployment secrets section like any other new credential.
 *
 * Stored rather than only printed because the hash is one-way — the edge probe
 * (`pnpm infra:plugins -- --deep`) reads the Traefik API through the
 * basic-auth-gated dashboard router, and an operator who lost the one-time
 * printout could never open the dashboard again either. Same reasoning as
 * SEED_ADMIN_PASSWORD.
 *
 * Studio is gated the same way and stores its plaintext for the same reason:
 * losing it would mean losing the only DB console, recoverable solely by
 * blanking the key and redeploying.
 */
function applyBasicAuthPair(state, pair) {
  const stale =
    isSampleOrMissing(pair.authKey, state.values.get(pair.authKey)) ||
    isSampleOrMissing(pair.passwordKey, state.values.get(pair.passwordKey));
  if (!stale) return;

  const generated = generateBasicAuth(pair);
  applyValue(state, pair.authKey, generated.envValue);
  applyValue(state, pair.passwordKey, generated.credential.password);
  state.generatedCredentials.push(generated.credential);
}

export async function ensureProdEnv(envPath = '.env', options = {}) {
  const examplePath = options.examplePath ?? '.env.example';
  const created = await ensureEnvFile(envPath, examplePath);
  const state = {
    content: await readFile(envPath, 'utf8'),
    values: new Map(),
    generated: [],
    generatedCredentials: [],
    prompted: [],
    normalized: [],
    created,
  };
  state.values = parseEnv(state.content);

  for (const pair of BASIC_AUTH_PAIRS) applyBasicAuthPair(state, pair);

  for (const [key, generate] of Object.entries(SECRET_GENERATORS)) {
    if (isSampleOrMissing(key, state.values.get(key))) {
      applyValue(state, key, generate(), 'generated');
    }
  }

  if (isSampleOrMissing('SUPABASE_ANON_KEY', state.values.get('SUPABASE_ANON_KEY'))) {
    applyValue(
      state,
      'SUPABASE_ANON_KEY',
      signSupabaseJwt('anon', state.values.get('SUPABASE_JWT_SECRET')),
      'generated',
    );
  }
  if (
    isSampleOrMissing('SUPABASE_SERVICE_ROLE_KEY', state.values.get('SUPABASE_SERVICE_ROLE_KEY'))
  ) {
    applyValue(
      state,
      'SUPABASE_SERVICE_ROLE_KEY',
      signSupabaseJwt('service_role', state.values.get('SUPABASE_JWT_SECRET')),
      'generated',
    );
  }

  let rl;
  try {
    for (const key of HUMAN_REQUIRED) {
      if (!isSampleOrMissing(key, state.values.get(key))) continue;
      rl ??= readline.createInterface({ input, output });
      const answer = await askValue(key, state.values.get(key), rl, options);
      applyValue(state, key, answer, 'prompted');
    }
  } finally {
    rl?.close();
  }

  const domain = state.values.get('DOMAIN');
  const supabaseUrl = `https://app.${domain}`;
  const apiUrl = `https://api.${domain}`;
  const anonKey = state.values.get('SUPABASE_ANON_KEY');

  for (const [key, value] of [
    ['SUPABASE_URL', supabaseUrl],
    ['NEXT_PUBLIC_SUPABASE_URL', supabaseUrl],
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', anonKey],
    // Per-app API URLs — preserve the per-service routing convention
    // (admin and public stay same-origin with their UI host so the
    // browser doesn't preflight every fetch; scoring uses the
    // dedicated api.${DOMAIN} subdomain).
    ['NEXT_PUBLIC_API_URL_ADMIN', `https://admin.${domain}`],
    ['NEXT_PUBLIC_API_URL_PUBLIC', supabaseUrl], // https://app.${DOMAIN}
    ['NEXT_PUBLIC_API_URL_STAFF', apiUrl], // https://api.${DOMAIN}
    // Cross-app deep links: admin → scoring app, admin/scoring → public app.
    ['NEXT_PUBLIC_STAFF_URL', `https://scoring.${domain}`],
    ['NEXT_PUBLIC_PUBLIC_APP_URL', supabaseUrl], // https://app.${DOMAIN}
    // The marketing site is the apex host (see the myclash-marketing router).
    ['NEXT_PUBLIC_MARKETING_URL', `https://${domain}`],
    ['POSTGRES_USER', state.values.get('POSTGRES_USER') || 'postgres'],
    ['POSTGRES_DB', state.values.get('POSTGRES_DB') || 'myclash'],
    ['TZ', state.values.get('TZ') || 'Europe/Paris'],
    ['COMPOSE_PROJECT_NAME', state.values.get('COMPOSE_PROJECT_NAME') || 'myclash'],
    ['SMTP_HOST', state.values.get('SMTP_HOST') || 'smtp.resend.com'],
    ['SMTP_PORT', state.values.get('SMTP_PORT') || '587'],
    ['SMTP_USER', state.values.get('SMTP_USER') || 'resend'],
    ['HEMA_RATINGS_SYNC_ENABLED', state.values.get('HEMA_RATINGS_SYNC_ENABLED') || 'true'],
    // Scaleway S3 defaults
    ['BACKUP_SCW_REGION', state.values.get('BACKUP_SCW_REGION') || 'fr-par'],
    [
      'BACKUP_SCW_ENDPOINT',
      state.values.get('BACKUP_SCW_ENDPOINT') || 'https://s3.fr-par.scw.cloud',
    ],
    ['BACKUP_RETENTION_DAYS', state.values.get('BACKUP_RETENTION_DAYS') || '60'],
    ['BACKUP_UPLOAD_MAX_BYTES', state.values.get('BACKUP_UPLOAD_MAX_BYTES') || '1073741824'],
    ['MULTIPART_MAX_BYTES', state.values.get('MULTIPART_MAX_BYTES') || '1073741824'],
    ['SENTRY_ENVIRONMENT', state.values.get('SENTRY_ENVIRONMENT') || 'production'],
    // Fresh deploys start with tracing on at 1-in-20. This only fills an ABSENT
    // key: isSampleOrMissing treats an explicit 0 as a real value, so an .env
    // that already reads 0 is left alone and must be changed by hand.
    ['SENTRY_TRACES_SAMPLE_RATE', state.values.get('SENTRY_TRACES_SAMPLE_RATE') || '0.05'],
    [
      'NEXT_PUBLIC_SENTRY_ENVIRONMENT',
      state.values.get('NEXT_PUBLIC_SENTRY_ENVIRONMENT') ||
        state.values.get('SENTRY_ENVIRONMENT') ||
        'production',
    ],
    [
      'NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE',
      state.values.get('NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE') ||
        state.values.get('SENTRY_TRACES_SAMPLE_RATE') ||
        '0.05',
    ],
  ]) {
    if (isSampleOrMissing(key, state.values.get(key))) {
      applyValue(state, key, value, 'normalized');
    }
  }

  if (state.values.get('GOOGLE_OAUTH_ENABLED') === 'true') {
    for (const key of ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET']) {
      if (isSampleOrMissing(key, state.values.get(key))) {
        throw new Error(`${key} is required when GOOGLE_OAUTH_ENABLED=true.`);
      }
    }
  }

  await writeFile(envPath, state.content.endsWith('\n') ? state.content : `${state.content}\n`);

  const vapid = await ensureVapidEnv(
    envPath,
    state.values.get('LETSENCRYPT_EMAIL') || 'webmaster@example.com',
  );
  if (vapid.generated) {
    state.generated.push('VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY');
  }
  if (isSampleOrMissing('VAPID_SUBJECT', state.values.get('VAPID_SUBJECT'))) {
    state.normalized.push('VAPID_SUBJECT');
  }

  return state;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const envPath = process.argv[2] ?? '.env';
  ensureProdEnv(envPath, { nonInteractive: !process.stdout.isTTY })
    .then((result) => {
      console.log(
        JSON.stringify({
          created: result.created,
          generated: [...new Set(result.generated)],
          generatedCredentials: result.generatedCredentials ?? [],
          prompted: [...new Set(result.prompted)],
          normalized: [...new Set(result.normalized)],
        }),
      );
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
