import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash, createHmac } from 'node:crypto';

import { ensureProdEnv, parseEnv } from './ensure-prod-env.mjs';

function decodePayload(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

function verifyHs256(token, secret) {
  const [header, payload, signature] = token.split('.');
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return signature === expected;
}

function verifyHtpasswdSha(storedValue, password) {
  const [, hash] = storedValue.split(':');
  assert.ok(hash?.startsWith('{SHA}'));
  const expected = `{SHA}${createHash('sha1').update(password).digest('base64')}`;
  return hash === expected;
}

function assertRealtimeDbEncKey(value) {
  assert.equal(Buffer.byteLength(value, 'utf8'), 16);
}

test('creates .env from sample and replaces generated secrets/default URLs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'myclash-prod-env-'));
  const envPath = path.join(dir, '.env');
  const examplePath = path.join(dir, '.env.example');

  await writeFile(
    examplePath,
    [
      'DOMAIN=yourdomain.com',
      'LETSENCRYPT_EMAIL=webmaster@example.com',
      'TZ=Europe/Paris',
      'COMPOSE_PROJECT_NAME=myclash',
      'TRAEFIK_DASHBOARD_AUTH=admin:$$2y$$05$$changeme',
      'STUDIO_BASIC_AUTH=admin:$$2y$$05$$changeme',
      'STUDIO_PASSWORD=',
      'COOKIE_SECRET=change-me-cookie-secret',
      'SUPABASE_URL=http://localhost:8000',
      'POSTGRES_USER=postgres',
      'POSTGRES_PASSWORD=change-me-strong-password',
      'POSTGRES_DB=myclash',
      'SUPABASE_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long',
      'SUPABASE_REALTIME_SECRET=a-very-long-secret-key-base-for-realtime-at-least-64-chars-long-here',
      'SUPABASE_REALTIME_DB_ENC_KEY=change-me-realtime-db-enc-key',
      'SUPABASE_ANON_KEY=change-me-anon-jwt',
      'SUPABASE_SERVICE_ROLE_KEY=change-me-service-role-jwt',
      'MYCLASH_GUEST_JWT_SECRET=change-me-guest-jwt-secret',
      'MYCLASH_STAFF_JWT_SECRET=change-me-staff-jwt-secret',
      'OPS_RUNNER_SECRET=change-me-ops-runner-secret',
      'RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'MAIL_FROM=noreply@myclash.fr',
      'SMTP_HOST=smtp.resend.com',
      'SMTP_PORT=587',
      'SMTP_USER=resend',
      'SMTP_PASS=',
      'GOOGLE_OAUTH_ENABLED=false',
      'NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY=change-me-anon-jwt',
      'NEXT_PUBLIC_API_URL=http://localhost:4000',
      'VAPID_PUBLIC_KEY=',
      'VAPID_PRIVATE_KEY=',
      'VAPID_SUBJECT=',
      '',
    ].join('\n'),
  );

  const result = await ensureProdEnv(envPath, {
    examplePath,
    nonInteractive: true,
    answers: {
      DOMAIN: 'example.org',
      LETSENCRYPT_EMAIL: 'ops@example.org',
      RESEND_API_KEY: 're_real_key',
      MAIL_FROM: 'noreply@example.org',
      SMTP_PASS: 're_real_key',
      SEED_ADMIN_EMAIL: 'admin@example.org',
      BACKUP_SCW_ACCESS_KEY: 'scw_access',
      BACKUP_SCW_SECRET_KEY: 'scw_secret',
      BACKUP_SCW_BUCKET: 'myclash-backups',
    },
  });

  const values = parseEnv(await readFile(envPath, 'utf8'));
  assert.equal(result.created, true);
  assert.equal(values.get('DOMAIN'), 'example.org');
  assert.equal(values.get('SUPABASE_URL'), 'https://app.example.org');
  // The single NEXT_PUBLIC_API_URL was split into three per-app vars, so this
  // used to assert on a variable the script no longer writes (and read back the
  // untouched localhost sample value). Assert the per-service routing the
  // script actually establishes: every app stays same-origin with its own UI
  // host, so the browser does not preflight every fetch and no bundle depends
  // on the api. subdomain's cert. Staff pointed at api. until 2026-08-13, which
  // is how an absolute host reached the pad and killed the maintenance banner.
  assert.equal(values.get('NEXT_PUBLIC_API_URL_ADMIN'), 'https://admin.example.org');
  assert.equal(values.get('NEXT_PUBLIC_API_URL_PUBLIC'), 'https://app.example.org');
  assert.equal(values.get('NEXT_PUBLIC_API_URL_STAFF'), 'https://staff.example.org');
  // No generated value may point at api.${DOMAIN}: browsers reject that host's
  // cert in this deploy, and it is server-to-server only.
  for (const key of [
    'NEXT_PUBLIC_API_URL_ADMIN',
    'NEXT_PUBLIC_API_URL_PUBLIC',
    'NEXT_PUBLIC_API_URL_STAFF',
  ]) {
    assert.notEqual(values.get(key), 'https://api.example.org');
  }
  assert.notEqual(values.get('POSTGRES_PASSWORD'), 'change-me-strong-password');
  assert.notEqual(values.get('COOKIE_SECRET'), 'change-me-cookie-secret');
  assert.match(values.get('TRAEFIK_DASHBOARD_AUTH'), /^admin:\{SHA\}.+/);
  // Every basic-auth surface in BASIC_AUTH_PAIRS generates from one sample .env:
  // the Traefik dashboard and Supabase Studio.
  assert.equal(result.generatedCredentials.length, 2);
  assert.deepEqual(
    result.generatedCredentials.map((c) => c.service),
    ['TRAEFIK_DASHBOARD', 'STUDIO'],
  );
  assert.deepEqual(result.generatedCredentials[0]?.username, 'admin');
  assert.equal(
    verifyHtpasswdSha(
      values.get('TRAEFIK_DASHBOARD_AUTH'),
      result.generatedCredentials[0]?.password,
    ),
    true,
  );
  // The plaintext is persisted, not only printed — and it is the SAME value the
  // hash was derived from. Asserting the round-trip against .env (not against
  // the returned credential) is what catches the two keys drifting apart.
  assert.equal(values.get('TRAEFIK_DASHBOARD_PASSWORD'), result.generatedCredentials[0]?.password);
  assert.equal(
    verifyHtpasswdSha(
      values.get('TRAEFIK_DASHBOARD_AUTH'),
      values.get('TRAEFIK_DASHBOARD_PASSWORD'),
    ),
    true,
  );
  // Studio is gated the same way and stores the same hash/plaintext round-trip.
  // It is the only DB console, so a drifted pair means no way in at all.
  assert.match(values.get('STUDIO_BASIC_AUTH'), /^admin:\{SHA\}.+/);
  assert.equal(values.get('STUDIO_PASSWORD'), result.generatedCredentials[1]?.password);
  assert.equal(
    verifyHtpasswdSha(values.get('STUDIO_BASIC_AUTH'), values.get('STUDIO_PASSWORD')),
    true,
  );
  // The two surfaces must never share a password.
  assert.notEqual(values.get('STUDIO_PASSWORD'), values.get('TRAEFIK_DASHBOARD_PASSWORD'));
  assert.notEqual(values.get('SUPABASE_REALTIME_DB_ENC_KEY'), 'change-me-realtime-db-enc-key');
  assertRealtimeDbEncKey(values.get('SUPABASE_REALTIME_DB_ENC_KEY'));
  assert.notEqual(values.get('OPS_RUNNER_SECRET'), 'change-me-ops-runner-secret');
  assert.ok(values.get('VAPID_PUBLIC_KEY'));
  assert.ok(values.get('VAPID_PRIVATE_KEY'));
});

test('generates matching Supabase anon and service-role JWTs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'myclash-prod-env-'));
  const envPath = path.join(dir, '.env');
  await writeFile(
    envPath,
    [
      'DOMAIN=example.org',
      'LETSENCRYPT_EMAIL=ops@example.org',
      'POSTGRES_PASSWORD=change-me-strong-password',
      'COOKIE_SECRET=change-me-cookie-secret',
      'SUPABASE_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long',
      'SUPABASE_REALTIME_SECRET=a-very-long-secret-key-base-for-realtime-at-least-64-chars-long-here',
      'SUPABASE_REALTIME_DB_ENC_KEY=change-me-realtime-db-enc-key',
      'SUPABASE_ANON_KEY=change-me-anon-jwt',
      'SUPABASE_SERVICE_ROLE_KEY=change-me-service-role-jwt',
      'MYCLASH_GUEST_JWT_SECRET=change-me-guest-jwt-secret',
      'MYCLASH_STAFF_JWT_SECRET=change-me-staff-jwt-secret',
      'OPS_RUNNER_SECRET=change-me-ops-runner-secret',
      'RESEND_API_KEY=re_real_key',
      'MAIL_FROM=noreply@example.org',
      'SMTP_PASS=re_real_key',
      'SEED_ADMIN_EMAIL=admin@example.org',
      'BACKUP_SCW_ACCESS_KEY=scw_access',
      'BACKUP_SCW_SECRET_KEY=scw_secret',
      'BACKUP_SCW_BUCKET=myclash-backups',
      'GOOGLE_OAUTH_ENABLED=false',
      '',
    ].join('\n'),
  );

  await ensureProdEnv(envPath, { nonInteractive: true });
  const values = parseEnv(await readFile(envPath, 'utf8'));

  assert.equal(decodePayload(values.get('SUPABASE_ANON_KEY')).role, 'anon');
  assert.equal(decodePayload(values.get('SUPABASE_SERVICE_ROLE_KEY')).role, 'service_role');
  assertRealtimeDbEncKey(values.get('SUPABASE_REALTIME_DB_ENC_KEY'));
  assert.equal(
    verifyHs256(values.get('SUPABASE_ANON_KEY'), values.get('SUPABASE_JWT_SECRET')),
    true,
  );
  assert.equal(
    verifyHs256(values.get('SUPABASE_SERVICE_ROLE_KEY'), values.get('SUPABASE_JWT_SECRET')),
    true,
  );
});

test('preserves real existing values', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'myclash-prod-env-'));
  const envPath = path.join(dir, '.env');
  await writeFile(
    envPath,
    [
      'DOMAIN=existing.example',
      'LETSENCRYPT_EMAIL=ops@existing.example',
      'TRAEFIK_DASHBOARD_AUTH=admin:{SHA}realhash',
      'TRAEFIK_DASHBOARD_PASSWORD=real-dashboard-password',
      'STUDIO_BASIC_AUTH=admin:{SHA}realstudiohash',
      'STUDIO_PASSWORD=real-studio-password',
      'POSTGRES_PASSWORD=real-db-password',
      'COOKIE_SECRET=real-cookie-secret',
      'SUPABASE_JWT_SECRET=real-supabase-secret-with-more-than-32-characters',
      'SUPABASE_REALTIME_SECRET=real-realtime-secret-with-more-than-64-characters-xxxxxxxxxxxxxxxx',
      'SUPABASE_REALTIME_DB_ENC_KEY=validrealtimekey',
      'SUPABASE_ANON_KEY=real-anon-token',
      'SUPABASE_SERVICE_ROLE_KEY=real-service-token',
      'MYCLASH_GUEST_JWT_SECRET=real-guest-secret',
      'MYCLASH_STAFF_JWT_SECRET=real-staff-secret',
      'RESEND_API_KEY=re_real_key',
      'MAIL_FROM=noreply@existing.example',
      'SMTP_PASS=re_real_key',
      'SEED_ADMIN_EMAIL=admin@existing.example',
      'BACKUP_SCW_ACCESS_KEY=scw_access',
      'BACKUP_SCW_SECRET_KEY=scw_secret',
      'BACKUP_SCW_BUCKET=myclash-backups',
      'GOOGLE_OAUTH_ENABLED=false',
      'VAPID_PUBLIC_KEY=real-vapid-public',
      'VAPID_PRIVATE_KEY=real-vapid-private',
      'VAPID_SUBJECT=mailto:push@existing.example',
      '',
    ].join('\n'),
  );

  const result = await ensureProdEnv(envPath, { nonInteractive: true });
  const values = parseEnv(await readFile(envPath, 'utf8'));

  assert.equal(values.get('POSTGRES_PASSWORD'), 'real-db-password');
  assert.equal(values.get('TRAEFIK_DASHBOARD_AUTH'), 'admin:{SHA}realhash');
  assert.equal(values.get('TRAEFIK_DASHBOARD_PASSWORD'), 'real-dashboard-password');
  assert.equal(values.get('STUDIO_BASIC_AUTH'), 'admin:{SHA}realstudiohash');
  assert.equal(values.get('STUDIO_PASSWORD'), 'real-studio-password');
  assert.equal(values.get('SUPABASE_REALTIME_DB_ENC_KEY'), 'validrealtimekey');
  assert.equal(values.get('SUPABASE_ANON_KEY'), 'real-anon-token');
  assert.equal(values.get('VAPID_PUBLIC_KEY'), 'real-vapid-public');
  assert.deepEqual(result.prompted, []);
  assert.deepEqual(result.generatedCredentials, []);
});

test('appends generated realtime DB encryption key to existing old env files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'myclash-prod-env-'));
  const envPath = path.join(dir, '.env');
  await writeFile(
    envPath,
    [
      'DOMAIN=existing.example',
      'LETSENCRYPT_EMAIL=ops@existing.example',
      'TRAEFIK_DASHBOARD_AUTH=admin:{SHA}realhash',
      'TRAEFIK_DASHBOARD_PASSWORD=real-dashboard-password',
      'STUDIO_BASIC_AUTH=admin:{SHA}realstudiohash',
      'STUDIO_PASSWORD=real-studio-password',
      'POSTGRES_PASSWORD=real-db-password',
      'COOKIE_SECRET=real-cookie-secret',
      'SUPABASE_JWT_SECRET=real-supabase-secret-with-more-than-32-characters',
      'SUPABASE_REALTIME_SECRET=real-realtime-secret-with-more-than-64-characters-xxxxxxxxxxxxxxxx',
      'SUPABASE_ANON_KEY=real-anon-token',
      'SUPABASE_SERVICE_ROLE_KEY=real-service-token',
      'MYCLASH_GUEST_JWT_SECRET=real-guest-secret',
      'MYCLASH_STAFF_JWT_SECRET=real-staff-secret',
      'RESEND_API_KEY=re_real_key',
      'MAIL_FROM=noreply@existing.example',
      'SMTP_PASS=re_real_key',
      'SEED_ADMIN_EMAIL=admin@existing.example',
      'BACKUP_SCW_ACCESS_KEY=scw_access',
      'BACKUP_SCW_SECRET_KEY=scw_secret',
      'BACKUP_SCW_BUCKET=myclash-backups',
      'GOOGLE_OAUTH_ENABLED=false',
      '',
    ].join('\n'),
  );

  const result = await ensureProdEnv(envPath, { nonInteractive: true });
  const values = parseEnv(await readFile(envPath, 'utf8'));

  assert.ok(values.get('SUPABASE_REALTIME_DB_ENC_KEY'));
  assert.notEqual(values.get('SUPABASE_REALTIME_DB_ENC_KEY'), 'change-me-realtime-db-enc-key');
  assertRealtimeDbEncKey(values.get('SUPABASE_REALTIME_DB_ENC_KEY'));
  assert.ok(result.generated.includes('SUPABASE_REALTIME_DB_ENC_KEY'));
  assert.equal(values.get('TRAEFIK_DASHBOARD_AUTH'), 'admin:{SHA}realhash');
  assert.deepEqual(result.generatedCredentials, []);
});

// Every .env written before TRAEFIK_DASHBOARD_PASSWORD existed carries a real
// hash and no plaintext. The hash is one-way, so the pair cannot be repaired —
// only regenerated, together. Half a pair would leave a dashboard nobody can
// open, which is why the guard triggers on EITHER key.
test('rotates the dashboard pair when the hash is real but the plaintext is missing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'myclash-prod-env-'));
  const envPath = path.join(dir, '.env');
  await writeFile(
    envPath,
    [
      'DOMAIN=existing.example',
      'LETSENCRYPT_EMAIL=ops@existing.example',
      'TRAEFIK_DASHBOARD_AUTH=admin:{SHA}realhash',
      'STUDIO_BASIC_AUTH=admin:{SHA}realstudiohash',
      'STUDIO_PASSWORD=real-studio-password',
      'POSTGRES_PASSWORD=real-db-password',
      'COOKIE_SECRET=real-cookie-secret',
      'SUPABASE_JWT_SECRET=real-supabase-secret-with-more-than-32-characters',
      'SUPABASE_REALTIME_SECRET=real-realtime-secret-with-more-than-64-characters-xxxxxxxxxxxxxxxx',
      'SUPABASE_REALTIME_DB_ENC_KEY=validrealtimekey',
      'SUPABASE_ANON_KEY=real-anon-token',
      'SUPABASE_SERVICE_ROLE_KEY=real-service-token',
      'MYCLASH_GUEST_JWT_SECRET=real-guest-secret',
      'MYCLASH_STAFF_JWT_SECRET=real-staff-secret',
      'RESEND_API_KEY=re_real_key',
      'MAIL_FROM=noreply@existing.example',
      'SMTP_PASS=re_real_key',
      'SEED_ADMIN_EMAIL=admin@existing.example',
      'BACKUP_SCW_ACCESS_KEY=scw_access',
      'BACKUP_SCW_SECRET_KEY=scw_secret',
      'BACKUP_SCW_BUCKET=myclash-backups',
      'GOOGLE_OAUTH_ENABLED=false',
      'VAPID_PUBLIC_KEY=real-vapid-public',
      'VAPID_PRIVATE_KEY=real-vapid-private',
      'VAPID_SUBJECT=mailto:push@existing.example',
      '',
    ].join('\n'),
  );

  const result = await ensureProdEnv(envPath, { nonInteractive: true });
  const values = parseEnv(await readFile(envPath, 'utf8'));

  assert.notEqual(values.get('TRAEFIK_DASHBOARD_AUTH'), 'admin:{SHA}realhash');
  assert.ok(values.get('TRAEFIK_DASHBOARD_PASSWORD'));
  assert.equal(
    verifyHtpasswdSha(
      values.get('TRAEFIK_DASHBOARD_AUTH'),
      values.get('TRAEFIK_DASHBOARD_PASSWORD'),
    ),
    true,
  );
  // Rotating silently would lock the operator out: the new password has to reach
  // the Deployment secrets section.
  assert.equal(result.generatedCredentials.length, 1);
  assert.equal(result.generatedCredentials[0]?.password, values.get('TRAEFIK_DASHBOARD_PASSWORD'));
  // Studio arrived with a whole pair and must be left alone — rotating a
  // surface the operator did not ask about is how a working login disappears.
  assert.equal(values.get('STUDIO_BASIC_AUTH'), 'admin:{SHA}realstudiohash');
});

// Same one-way-hash reasoning as the dashboard, one surface further: every .env
// written before Studio existed has neither key, and any .env that grew only the
// hash cannot have its plaintext recovered.
test('rotates the studio pair independently of the dashboard pair', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'myclash-prod-env-'));
  const envPath = path.join(dir, '.env');
  await writeFile(
    envPath,
    [
      'DOMAIN=existing.example',
      'LETSENCRYPT_EMAIL=ops@existing.example',
      'TRAEFIK_DASHBOARD_AUTH=admin:{SHA}realhash',
      'TRAEFIK_DASHBOARD_PASSWORD=real-dashboard-password',
      'STUDIO_BASIC_AUTH=admin:{SHA}realstudiohash',
      'POSTGRES_PASSWORD=real-db-password',
      'COOKIE_SECRET=real-cookie-secret',
      'SUPABASE_JWT_SECRET=real-supabase-secret-with-more-than-32-characters',
      'SUPABASE_REALTIME_SECRET=real-realtime-secret-with-more-than-64-characters-xxxxxxxxxxxxxxxx',
      'SUPABASE_REALTIME_DB_ENC_KEY=validrealtimekey',
      'SUPABASE_ANON_KEY=real-anon-token',
      'SUPABASE_SERVICE_ROLE_KEY=real-service-token',
      'MYCLASH_GUEST_JWT_SECRET=real-guest-secret',
      'MYCLASH_STAFF_JWT_SECRET=real-staff-secret',
      'RESEND_API_KEY=re_real_key',
      'MAIL_FROM=noreply@existing.example',
      'SMTP_PASS=re_real_key',
      'SEED_ADMIN_EMAIL=admin@existing.example',
      'BACKUP_SCW_ACCESS_KEY=scw_access',
      'BACKUP_SCW_SECRET_KEY=scw_secret',
      'BACKUP_SCW_BUCKET=myclash-backups',
      'GOOGLE_OAUTH_ENABLED=false',
      'VAPID_PUBLIC_KEY=real-vapid-public',
      'VAPID_PRIVATE_KEY=real-vapid-private',
      'VAPID_SUBJECT=mailto:push@existing.example',
      '',
    ].join('\n'),
  );

  const result = await ensureProdEnv(envPath, { nonInteractive: true });
  const values = parseEnv(await readFile(envPath, 'utf8'));

  assert.notEqual(values.get('STUDIO_BASIC_AUTH'), 'admin:{SHA}realstudiohash');
  assert.ok(values.get('STUDIO_PASSWORD'));
  assert.equal(
    verifyHtpasswdSha(values.get('STUDIO_BASIC_AUTH'), values.get('STUDIO_PASSWORD')),
    true,
  );
  // The dashboard pair was intact, so only Studio rotates — one surface's
  // repair must not invalidate the other's credential.
  assert.equal(values.get('TRAEFIK_DASHBOARD_AUTH'), 'admin:{SHA}realhash');
  assert.equal(values.get('TRAEFIK_DASHBOARD_PASSWORD'), 'real-dashboard-password');
  assert.equal(result.generatedCredentials.length, 1);
  assert.equal(result.generatedCredentials[0]?.service, 'STUDIO');
});

test('fails non-interactive mode when human-owned values are missing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'myclash-prod-env-'));
  const envPath = path.join(dir, '.env');
  await writeFile(
    envPath,
    [
      'DOMAIN=yourdomain.com',
      'LETSENCRYPT_EMAIL=webmaster@example.com',
      'POSTGRES_PASSWORD=real-db-password',
      'COOKIE_SECRET=real-cookie-secret',
      'SUPABASE_JWT_SECRET=real-supabase-secret-with-more-than-32-characters',
      'SUPABASE_REALTIME_SECRET=real-realtime-secret-with-more-than-64-characters-xxxxxxxxxxxxxxxx',
      'SUPABASE_REALTIME_DB_ENC_KEY=validrealtimekey',
      'SUPABASE_ANON_KEY=real-anon-token',
      'SUPABASE_SERVICE_ROLE_KEY=real-service-token',
      'MYCLASH_GUEST_JWT_SECRET=real-guest-secret',
      'MYCLASH_STAFF_JWT_SECRET=real-staff-secret',
      'RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'MAIL_FROM=noreply@myclash.fr',
      'SMTP_PASS=',
      'GOOGLE_OAUTH_ENABLED=false',
      '',
    ].join('\n'),
  );

  await assert.rejects(
    ensureProdEnv(envPath, { nonInteractive: true }),
    /DOMAIN is set to a sample value/,
  );
});

test('regenerates invalid realtime DB encryption key lengths', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'myclash-prod-env-'));
  const envPath = path.join(dir, '.env');
  await writeFile(
    envPath,
    [
      'DOMAIN=existing.example',
      'LETSENCRYPT_EMAIL=ops@existing.example',
      'TRAEFIK_DASHBOARD_AUTH=admin:{SHA}realhash',
      'STUDIO_BASIC_AUTH=admin:{SHA}realstudiohash',
      'STUDIO_PASSWORD=real-studio-password',
      'POSTGRES_PASSWORD=real-db-password',
      'COOKIE_SECRET=real-cookie-secret',
      'SUPABASE_JWT_SECRET=real-supabase-secret-with-more-than-32-characters',
      'SUPABASE_REALTIME_SECRET=real-realtime-secret-with-more-than-64-characters-xxxxxxxxxxxxxxxx',
      'SUPABASE_REALTIME_DB_ENC_KEY=qYPL1uq9F3pEktQT4JGqKw',
      'SUPABASE_ANON_KEY=real-anon-token',
      'SUPABASE_SERVICE_ROLE_KEY=real-service-token',
      'MYCLASH_GUEST_JWT_SECRET=real-guest-secret',
      'MYCLASH_STAFF_JWT_SECRET=real-staff-secret',
      'RESEND_API_KEY=re_real_key',
      'MAIL_FROM=noreply@existing.example',
      'SMTP_PASS=re_real_key',
      'SEED_ADMIN_EMAIL=admin@existing.example',
      'BACKUP_SCW_ACCESS_KEY=scw_access',
      'BACKUP_SCW_SECRET_KEY=scw_secret',
      'BACKUP_SCW_BUCKET=myclash-backups',
      'GOOGLE_OAUTH_ENABLED=false',
      '',
    ].join('\n'),
  );

  const result = await ensureProdEnv(envPath, { nonInteractive: true });
  const values = parseEnv(await readFile(envPath, 'utf8'));

  assert.notEqual(values.get('SUPABASE_REALTIME_DB_ENC_KEY'), 'qYPL1uq9F3pEktQT4JGqKw');
  assertRealtimeDbEncKey(values.get('SUPABASE_REALTIME_DB_ENC_KEY'));
  assert.ok(result.generated.includes('SUPABASE_REALTIME_DB_ENC_KEY'));
});

test('production compose exposes the Google OAuth callback and app allow-list', async () => {
  const compose = await readFile(
    path.join(import.meta.dirname, '..', 'infra', 'docker-compose.prod.yml'),
    'utf8',
  );

  assert.match(
    compose,
    /GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI: https:\/\/app\.\$\{DOMAIN\}\/auth\/v1\/callback/,
  );
  assert.match(compose, /https:\/\/admin\.\$\{DOMAIN\}\/auth\/oauth\/callback/);
  assert.match(compose, /https:\/\/app\.\$\{DOMAIN\}\/auth\/oauth\/callback/);
  assert.match(compose, /https:\/\/admin\.\$\{DOMAIN\}\/signup\/oauth\/callback/);
});
