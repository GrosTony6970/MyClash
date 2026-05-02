import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ensureVapidEnv } from './ensure-vapid-env.mjs';

test('fills existing empty VAPID keys in .env without appending duplicates', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'myclash-vapid-'));
  const envPath = path.join(dir, '.env');
  await writeFile(
    envPath,
    [
      'DOMAIN=myclash.fr',
      'LETSENCRYPT_EMAIL=webmaster@example.com',
      'VAPID_PUBLIC_KEY=',
      'VAPID_PRIVATE_KEY=',
      'VAPID_SUBJECT=',
      '',
    ].join('\n'),
  );

  const result = await ensureVapidEnv(envPath, 'webmaster@example.com', {
    generateKeys: () => ({ publicKey: 'public-key', privateKey: 'private-key' }),
  });

  const updated = await readFile(envPath, 'utf8');
  assert.equal(result.generated, true);
  assert.match(updated, /^VAPID_PUBLIC_KEY=public-key$/m);
  assert.match(updated, /^VAPID_PRIVATE_KEY=private-key$/m);
  assert.match(updated, /^VAPID_SUBJECT=mailto:webmaster@example.com$/m);
  assert.equal(updated.match(/^VAPID_PUBLIC_KEY=/gm)?.length, 1);
  assert.equal(updated.match(/^VAPID_PRIVATE_KEY=/gm)?.length, 1);
});

test('preserves a complete existing VAPID key pair', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'myclash-vapid-'));
  const envPath = path.join(dir, '.env');
  await writeFile(
    envPath,
    [
      'VAPID_PUBLIC_KEY=existing-public',
      'VAPID_PRIVATE_KEY=existing-private',
      'VAPID_SUBJECT=mailto:push@example.com',
      '',
    ].join('\n'),
  );

  const result = await ensureVapidEnv(envPath, 'webmaster@example.com', {
    generateKeys: () => {
      throw new Error('should not generate');
    },
  });

  const updated = await readFile(envPath, 'utf8');
  assert.equal(result.generated, false);
  assert.match(updated, /^VAPID_PUBLIC_KEY=existing-public$/m);
  assert.match(updated, /^VAPID_PRIVATE_KEY=existing-private$/m);
  assert.match(updated, /^VAPID_SUBJECT=mailto:push@example.com$/m);
});
