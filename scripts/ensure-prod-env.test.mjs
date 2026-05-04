import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHmac } from 'node:crypto';

import { ensureProdEnv, parseEnv } from './ensure-prod-env.mjs';

function decodePayload(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

function verifyHs256(token, secret) {
  const [header, payload, signature] = token.split('.');
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return signature === expected;
}

test('creates .env from sample and replaces generated secrets/default URLs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'myclash-prod-env-'));
  const envPath = path.join(dir, '.env');
  const examplePath = path.join(dir, '.env.example');

  await writeFile(
    examplePath,
    [
      'DOMAIN=myclash.fr',
      'LETSENCRYPT_EMAIL=webmaster@example.com',
      'TZ=Europe/Paris',
      'COMPOSE_PROJECT_NAME=myclash',
      'COOKIE_SECRET=change-me-cookie-secret',
      'SUPABASE_URL=http://localhost:8000',
      'POSTGRES_USER=postgres',
      'POSTGRES_PASSWORD=change-me-strong-password',
      'POSTGRES_DB=myclash',
      'SUPABASE_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long',
      'SUPABASE_REALTIME_SECRET=a-very-long-secret-key-base-for-realtime-at-least-64-chars-long-here',
      'SUPABASE_ANON_KEY=change-me-anon-jwt',
      'SUPABASE_SERVICE_ROLE_KEY=change-me-service-role-jwt',
      'MYCLASH_GUEST_JWT_SECRET=change-me-guest-jwt-secret',
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
    },
  });

  const values = parseEnv(await readFile(envPath, 'utf8'));
  assert.equal(result.created, true);
  assert.equal(values.get('DOMAIN'), 'example.org');
  assert.equal(values.get('SUPABASE_URL'), 'https://app.example.org');
  assert.equal(values.get('NEXT_PUBLIC_API_URL'), 'https://api.example.org');
  assert.notEqual(values.get('POSTGRES_PASSWORD'), 'change-me-strong-password');
  assert.notEqual(values.get('COOKIE_SECRET'), 'change-me-cookie-secret');
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
      'SUPABASE_ANON_KEY=change-me-anon-jwt',
      'SUPABASE_SERVICE_ROLE_KEY=change-me-service-role-jwt',
      'MYCLASH_GUEST_JWT_SECRET=change-me-guest-jwt-secret',
      'RESEND_API_KEY=re_real_key',
      'MAIL_FROM=noreply@example.org',
      'SMTP_PASS=re_real_key',
      'GOOGLE_OAUTH_ENABLED=false',
      '',
    ].join('\n'),
  );

  await ensureProdEnv(envPath, { nonInteractive: true });
  const values = parseEnv(await readFile(envPath, 'utf8'));

  assert.equal(decodePayload(values.get('SUPABASE_ANON_KEY')).role, 'anon');
  assert.equal(decodePayload(values.get('SUPABASE_SERVICE_ROLE_KEY')).role, 'service_role');
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
      'POSTGRES_PASSWORD=real-db-password',
      'COOKIE_SECRET=real-cookie-secret',
      'SUPABASE_JWT_SECRET=real-supabase-secret-with-more-than-32-characters',
      'SUPABASE_REALTIME_SECRET=real-realtime-secret-with-more-than-64-characters-xxxxxxxxxxxxxxxx',
      'SUPABASE_ANON_KEY=real-anon-token',
      'SUPABASE_SERVICE_ROLE_KEY=real-service-token',
      'MYCLASH_GUEST_JWT_SECRET=real-guest-secret',
      'RESEND_API_KEY=re_real_key',
      'MAIL_FROM=noreply@existing.example',
      'SMTP_PASS=re_real_key',
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
  assert.equal(values.get('SUPABASE_ANON_KEY'), 'real-anon-token');
  assert.equal(values.get('VAPID_PUBLIC_KEY'), 'real-vapid-public');
  assert.deepEqual(result.prompted, []);
});

test('fails non-interactive mode when human-owned values are missing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'myclash-prod-env-'));
  const envPath = path.join(dir, '.env');
  await writeFile(
    envPath,
    [
      'DOMAIN=myclash.fr',
      'LETSENCRYPT_EMAIL=webmaster@example.com',
      'POSTGRES_PASSWORD=real-db-password',
      'COOKIE_SECRET=real-cookie-secret',
      'SUPABASE_JWT_SECRET=real-supabase-secret-with-more-than-32-characters',
      'SUPABASE_REALTIME_SECRET=real-realtime-secret-with-more-than-64-characters-xxxxxxxxxxxxxxxx',
      'SUPABASE_ANON_KEY=real-anon-token',
      'SUPABASE_SERVICE_ROLE_KEY=real-service-token',
      'MYCLASH_GUEST_JWT_SECRET=real-guest-secret',
      'RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'MAIL_FROM=noreply@myclash.fr',
      'SMTP_PASS=',
      'GOOGLE_OAUTH_ENABLED=false',
      '',
    ].join('\n'),
  );

  await assert.rejects(
    ensureProdEnv(envPath, { nonInteractive: true }),
    /DOMAIN is missing or still set to a sample value/,
  );
});
