import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { acquireOpsLock, releaseOpsLock } from './ops-lock.mjs';
import { stagedPath } from './upload-store.mjs';
import {
  DB,
  NIGHT,
  STORAGE,
  partialDir,
  partialFiles,
  refusalOf,
  sendAll,
  setup,
  start,
} from './upload-chunks.fixtures.mjs';

const CONTENT = Buffer.from('0123456789abcdef');

async function received(sessions, filename = DB, content = CONTENT) {
  const { uploadId } = await start(sessions, filename, content);
  await sendAll(sessions, uploadId, content);
  return uploadId;
}

async function jsonOf(rootDir, id) {
  return JSON.parse(await readFile(path.join(partialDir(rootDir), `${id}.json`), 'utf8'));
}

test('complete before every byte arrived is refused with the offset the server holds', async () => {
  const { sessions } = await setup();
  const { uploadId } = await start(sessions, DB, CONTENT);
  await sendAll(sessions, uploadId, CONTENT.subarray(0, 8));
  assert.deepEqual(await refusalOf(sessions.complete(uploadId)), {
    status: 409,
    code: 'upload_incomplete',
    details: { receivedBytes: 8 },
  });
});

test('a complete upload is checked, then kept as its night: staged, with the set', async () => {
  const { rootDir, sessions, verified } = await setup();
  const uploadId = await received(sessions);
  assert.equal((await sessions.complete(uploadId)).state, 'verifying');
  await sessions.idle();
  const staged = await sessions.status(uploadId);
  assert.equal(staged.state, 'staged');
  assert.equal(staged.backup.id, `upload-${NIGHT}`);
  assert.deepEqual(await readFile(stagedPath(rootDir, DB)), CONTENT);
  assert.equal(verified.length, 1);
  assert.deepEqual(await partialFiles(rootDir), [`${uploadId}.json`]);
  assert.equal((await sessions.complete(uploadId)).state, 'staged', 'complete is idempotent');
});

test('a corrupt file fails: its bytes go, and complete says so again', async () => {
  const { rootDir, sessions } = await setup({ verify: false });
  const uploadId = await received(sessions);
  await sessions.complete(uploadId);
  await sessions.idle();
  const failed = await sessions.status(uploadId);
  assert.deepEqual([failed.state, failed.code], ['failed', 'upload_corrupt']);
  assert.deepEqual(await partialFiles(rootDir), [`${uploadId}.json`]);
  assert.equal((await refusalOf(sessions.complete(uploadId))).code, 'upload_corrupt');
  assert.equal(existsSync(stagedPath(rootDir, DB)), false);
});

test('an encrypted file is not checked (no key in the runner)', async () => {
  const { sessions, verified } = await setup();
  const uploadId = await received(sessions, `${DB}.gpg`);
  await sessions.complete(uploadId);
  await sessions.idle();
  assert.equal((await sessions.status(uploadId)).state, 'staged');
  assert.equal(verified.length, 0);
});

test('a busy lock sends the checked file back to receiving; the next complete stages it', async () => {
  const { rootDir, sessions, verified } = await setup();
  const uploadId = await received(sessions);
  const lock = await acquireOpsLock(rootDir, { kind: 'restore' });
  await sessions.complete(uploadId);
  await sessions.idle();
  const waiting = await sessions.status(uploadId);
  assert.deepEqual([waiting.state, waiting.code], ['receiving', 'ops_busy']);
  await releaseOpsLock(lock);
  await sessions.complete(uploadId);
  await sessions.idle();
  assert.equal((await sessions.status(uploadId)).state, 'staged');
  assert.equal(verified.length, 1, 'the check is not run twice');
});

test('Cancel during the check is refused; a same-name start waits for it too', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { sessions } = await setup({ verify: () => gate });
  const uploadId = await received(sessions);
  await sessions.complete(uploadId);
  assert.equal((await refusalOf(sessions.cancel(uploadId))).code, 'upload_not_receiving');
  assert.equal((await refusalOf(start(sessions, DB, CONTENT))).code, 'upload_not_receiving');
  release(true);
  await sessions.idle();
});

test('Delete all during the check: the upload is gone, nothing is written back', async () => {
  const holder = {};
  const { rootDir, sessions } = await setup({
    verify: async () => {
      await rm(partialDir(holder.rootDir), { recursive: true, force: true });
      return true;
    },
  });
  holder.rootDir = rootDir;
  const uploadId = await received(sessions);
  await sessions.complete(uploadId);
  await sessions.idle();
  assert.equal((await refusalOf(sessions.status(uploadId))).code, 'upload_gone');
  assert.deepEqual(await partialFiles(rootDir), []);
  assert.equal(existsSync(stagedPath(rootDir, DB)), false);
});

test('a throw inside the background job is recorded as failed; the process lives', async () => {
  const { sessions } = await setup({
    verify: async () => {
      throw new Error('gzip vanished');
    },
  });
  const uploadId = await received(sessions);
  await sessions.complete(uploadId);
  await sessions.idle();
  const failed = await sessions.status(uploadId);
  assert.deepEqual([failed.state, failed.error], ['failed', 'gzip vanished']);
});

test('a check whose job died without a word starts again on the next complete', async () => {
  const { rootDir, sessions } = await setup();
  const uploadId = await received(sessions);
  const json = await jsonOf(rootDir, uploadId);
  // What a failure that could not even be written leaves: `verifying`, and no job alive.
  await writeFile(
    path.join(partialDir(rootDir), `${uploadId}.json`),
    JSON.stringify({ ...json, state: 'verifying' }),
  );
  assert.equal((await sessions.complete(uploadId)).state, 'verifying');
  await sessions.idle();
  assert.equal((await sessions.status(uploadId)).state, 'staged');
});

test('a failure that is not the file keeps its bytes; the same file again finishes it', async () => {
  let broken = true;
  const { rootDir, sessions, verified } = await setup({
    withLock: async (fn) => {
      if (broken) throw new Error('EMFILE: too many open files');
      return fn();
    },
  });
  const uploadId = await received(sessions);
  await sessions.complete(uploadId);
  await sessions.idle();
  const failed = await sessions.status(uploadId);
  assert.deepEqual([failed.state, failed.code], ['failed', 'upload_failed']);
  assert.deepEqual(await readFile(path.join(partialDir(rootDir), uploadId)), CONTENT);
  assert.equal((await refusalOf(sessions.complete(uploadId))).code, 'upload_failed');

  broken = false;
  const again = await start(sessions, DB, CONTENT);
  assert.deepEqual([again.uploadId, again.state, again.receivedBytes], [uploadId, 'receiving', 16]);
  await sessions.complete(uploadId);
  await sessions.idle();
  assert.equal((await sessions.status(uploadId)).state, 'staged');
  assert.equal(verified.length, 2, 'a resumed upload is checked again');
});

test('a move that fails after its staging mark stays staging, and complete finishes it', async () => {
  const { rootDir, sessions } = await setup();
  const uploadId = await received(sessions);
  // The night's file name is taken by a folder: the rename fails after `staging` is written.
  await mkdir(stagedPath(rootDir, DB), { recursive: true });
  await sessions.complete(uploadId);
  await sessions.idle();
  assert.equal((await sessions.status(uploadId)).state, 'staging');
  await rm(stagedPath(rootDir, DB), { recursive: true });
  await sessions.complete(uploadId);
  await sessions.idle();
  assert.equal((await sessions.status(uploadId)).state, 'staged');
  assert.deepEqual(await readFile(stagedPath(rootDir, DB)), CONTENT);
});

test('bytes that went during the check (not the JSON): the upload is gone', async () => {
  const { rootDir, sessions } = await setup({
    verify: async (file) => {
      await rm(file);
      return true;
    },
  });
  const uploadId = await received(sessions);
  await sessions.complete(uploadId);
  await sessions.idle();
  assert.equal((await refusalOf(sessions.status(uploadId))).code, 'upload_gone');
  assert.deepEqual(await partialFiles(rootDir), []);
});

test('a staging mark older than 24 h is still recovered at boot', async () => {
  const { rootDir, clock, sessions } = await setup();
  const uploadId = await crashedInStaging(rootDir, sessions, { moved: false });
  clock.now = new Date(clock.now.getTime() + 3 * 24 * 60 * 60 * 1000);
  await sessions.sweep({ boot: true });
  await sessions.idle();
  assert.equal((await sessions.status(uploadId)).state, 'staged');
});

test('a staged or failed upload of the same name makes way for a new start', async () => {
  const { rootDir, sessions } = await setup();
  const staged = await received(sessions);
  await sessions.complete(staged);
  await sessions.idle();
  const next = await start(sessions, DB, CONTENT);
  assert.notEqual(next.uploadId, staged);
  assert.equal(next.receivedBytes, 0);
  assert.deepEqual(await partialFiles(rootDir), [next.uploadId, `${next.uploadId}.json`]);
});

/** A JSON left at `staging` by a crash, with or without its bytes moved. */
async function crashedInStaging(rootDir, sessions, { moved }) {
  const uploadId = await received(sessions, STORAGE);
  const json = await jsonOf(rootDir, uploadId);
  const target = stagedPath(rootDir, STORAGE);
  await writeFile(
    path.join(partialDir(rootDir), `${uploadId}.json`),
    JSON.stringify({ ...json, state: 'staging', target }),
  );
  if (moved) {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, CONTENT);
    await rm(path.join(partialDir(rootDir), uploadId));
  }
  return uploadId;
}

test('boot recovers a staging upload whose bytes were already moved', async () => {
  const { rootDir, sessions } = await setup();
  const uploadId = await crashedInStaging(rootDir, sessions, { moved: true });
  await sessions.sweep({ boot: true });
  await sessions.idle();
  assert.equal((await sessions.status(uploadId)).state, 'staged');
});

test('boot finishes the move of a staging upload whose bytes are still there', async () => {
  const { rootDir, sessions } = await setup();
  const uploadId = await crashedInStaging(rootDir, sessions, { moved: false });
  await sessions.sweep({ boot: true });
  await sessions.idle();
  assert.equal((await sessions.status(uploadId)).state, 'staged');
  assert.deepEqual(await readFile(stagedPath(rootDir, STORAGE)), CONTENT);
});

test('a staging recovery that meets the lock keeps staging; complete finishes it later', async () => {
  const { rootDir, sessions } = await setup();
  const uploadId = await crashedInStaging(rootDir, sessions, { moved: false });
  const lock = await acquireOpsLock(rootDir, { kind: 'backup' });
  await sessions.complete(uploadId);
  await sessions.idle();
  const waiting = await sessions.status(uploadId);
  assert.deepEqual([waiting.state, waiting.code], ['staging', 'ops_busy']);
  await releaseOpsLock(lock);
  await sessions.complete(uploadId);
  await sessions.idle();
  assert.equal((await sessions.status(uploadId)).state, 'staged');
});

test('a staging upload whose bytes and target are both gone fails as gone', async () => {
  const { rootDir, sessions } = await setup();
  const uploadId = await crashedInStaging(rootDir, sessions, { moved: true });
  await rm(stagedPath(rootDir, STORAGE));
  await sessions.complete(uploadId);
  await sessions.idle();
  const failed = await sessions.status(uploadId);
  assert.deepEqual([failed.state, failed.code], ['failed', 'upload_gone']);
});

test('boot sends a check that died with the process back to receiving', async () => {
  const { rootDir, sessions } = await setup();
  const uploadId = await received(sessions);
  const json = await jsonOf(rootDir, uploadId);
  await writeFile(
    path.join(partialDir(rootDir), `${uploadId}.json`),
    JSON.stringify({ ...json, state: 'verifying' }),
  );
  await sessions.sweep({ boot: true });
  assert.equal((await sessions.status(uploadId)).state, 'receiving');
  assert.equal((await sessions.status(uploadId)).receivedBytes, 16);
});
