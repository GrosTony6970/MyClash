import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ensureProdEnv, parseEnv } from './ensure-prod-env.mjs';

/**
 * Realtime's management API (/api/tenants) takes any token signed with its secret and never reads
 * the role. On the shared JWT secret the public anon key was a management token (rulings 420,
 * 424), so the secret is Realtime's own, generated when absent (ruling 421) and never equal to the
 * JWT secret. No token signed with it is stored: Realtime's start script mints one (ruling 506).
 */
const JWT_SECRET = 'real-jwt-secret-with-at-least-32-characters-long-xx';
const KEY = 'SUPABASE_REALTIME_API_SECRET';

async function repair(lines) {
  const dir = await mkdtemp(path.join(tmpdir(), 'myclash-prod-env-rt-api-'));
  const envPath = path.join(dir, '.env');
  await writeFile(
    envPath,
    [
      'DOMAIN=example.org',
      'LETSENCRYPT_EMAIL=ops@example.org',
      `SUPABASE_JWT_SECRET=${JWT_SECRET}`,
      'RESEND_API_KEY=re_real_key',
      'MAIL_FROM=noreply@example.org',
      'SMTP_PASS=re_real_key',
      'SEED_ADMIN_EMAIL=admin@example.org',
      'BACKUP_SCW_ACCESS_KEY=scw_access',
      'BACKUP_SCW_SECRET_KEY=scw_secret',
      'BACKUP_SCW_BUCKET=myclash-backups',
      'GOOGLE_OAUTH_ENABLED=false',
      ...lines,
      '',
    ].join('\n'),
  );
  const result = await ensureProdEnv(envPath, { nonInteractive: true });
  return { result, values: parseEnv(await readFile(envPath, 'utf8')) };
}

test('an .env written before the secret existed gets one, not the JWT secret', async () => {
  const { result, values } = await repair([]);
  assert.ok(result.generated.includes(KEY));
  assert.ok((values.get(KEY) ?? '').length >= 48);
  assert.notEqual(values.get(KEY), JWT_SECRET);
});

test('the .env.example sample is replaced', async () => {
  const example = parseEnv(
    await readFile(path.join(import.meta.dirname, '..', '.env.example'), 'utf8'),
  );
  const sample = example.get(KEY);
  assert.ok(sample, '.env.example must carry the key');
  const { values } = await repair([`${KEY}=${sample}`]);
  assert.notEqual(values.get(KEY), sample);
});

test('the dev compose fallback is replaced', async () => {
  const compose = await readFile(
    path.join(import.meta.dirname, '..', 'infra', 'docker-compose.dev.yml'),
    'utf8',
  );
  const fallback = /API_JWT_SECRET: \$\{SUPABASE_REALTIME_API_SECRET:-([^}]+)\}/u.exec(
    compose,
  )?.[1];
  assert.ok(fallback, 'the dev compose must give Realtime a fallback secret of its own');
  const { values } = await repair([`${KEY}=${fallback}`]);
  assert.notEqual(values.get(KEY), fallback);
});

test('a secret equal to the JWT secret is replaced', async () => {
  const { result, values } = await repair([`${KEY}=${JWT_SECRET}`]);
  assert.ok(result.generated.includes(KEY));
  assert.notEqual(values.get(KEY), JWT_SECRET);
  assert.equal(values.get('SUPABASE_JWT_SECRET'), JWT_SECRET);
});

test('a real secret is kept', async () => {
  const secret = 'a-real-realtime-api-secret-with-enough-characters-xx';
  const { result, values } = await repair([`${KEY}=${secret}`]);
  assert.equal(values.get(KEY), secret);
  assert.ok(!result.generated.includes(KEY));
});
