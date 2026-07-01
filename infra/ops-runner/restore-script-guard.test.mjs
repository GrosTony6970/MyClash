// Guard test: the backup/restore shell scripts must keep the safety
// properties that make a restore actually work and stay schema-coherent.
// A future edit that silently drops any of these would reintroduce a
// site-down or silent-partial-restore bug, so we pin them here.
//
// Run with: node --test infra/ops-runner/restore-script-guard.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.join(here, '..', 'scripts');
const restore = await readFile(path.join(scriptsDir, 'restore.sh'), 'utf8');
const backup = await readFile(path.join(scriptsDir, 'backup.sh'), 'utf8');

test('restore.sh replays atomically and stops on the first SQL error', () => {
  assert.ok(restore.includes('ON_ERROR_STOP=1'), 'psql must use -v ON_ERROR_STOP=1');
  assert.ok(
    restore.includes('--single-transaction'),
    'the replay must run in a single transaction so a bad dump rolls back',
  );
});

test('restore.sh force-drops so a connected sidecar cannot block DROP DATABASE', () => {
  assert.ok(
    restore.includes('WITH (FORCE)'),
    'DROP DATABASE must use WITH (FORCE) to evict straggler sessions',
  );
});

test('restore.sh stops every service that holds a DB connection before dropping', () => {
  for (const svc of ['supabase-auth', 'supabase-rest', 'supabase-realtime', 'supabase-storage']) {
    assert.ok(restore.includes(svc), `restore.sh must stop ${svc} before DROP DATABASE`);
  }
});

test('restore.sh validates schema coherence after the replay', () => {
  assert.ok(restore.includes('information_schema.schemata'), 'must verify required schemas exist');
  assert.ok(restore.includes('auth.users'), 'must verify auth.users survived the restore');
});

test('restore.sh verifies archive integrity before any destructive action', () => {
  assert.ok(restore.includes('gunzip -t'), 'must gzip-test the dump before dropping the database');
});

test('restore.sh judges storage restore by the extractor exit, not gunzip (SIGPIPE safe)', () => {
  // busybox `tar xf -` stops reading at the archive end marker before draining
  // gzip's padding, giving gunzip a SIGPIPE. Success must be judged by the
  // container's exit (PIPESTATUS[1]), or a good restore is reported as failed.
  assert.ok(
    restore.includes('PIPESTATUS'),
    'storage restore must check the extractor exit via PIPESTATUS, not the piped gunzip',
  );
});

test('backup + restore operate on the named storage volume, not the empty host dir', () => {
  assert.ok(
    backup.includes('$STORAGE_VOLUME:/vol:ro'),
    'backup.sh must archive the named storage volume via a helper container',
  );
  assert.ok(
    restore.includes('$STORAGE_VOLUME:/vol'),
    'restore.sh must restore into the named storage volume',
  );
  assert.ok(
    !backup.includes('-C "$ROOT_DIR/data" storage'),
    'backup.sh must no longer tar the empty ./data/storage host directory',
  );
});

test('backup.sh fails closed when encryption is requested but cannot be performed', () => {
  assert.ok(
    /refusing to (keep|ship)/i.test(backup),
    'a configured GPG recipient with a failed/absent gpg must fail the backup, never ship plaintext',
  );
});
