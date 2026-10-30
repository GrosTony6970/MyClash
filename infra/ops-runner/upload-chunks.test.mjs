import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { removeAllUploads } from './upload-store.mjs';
import {
  DAY_MS,
  DB,
  STORAGE,
  partialDir,
  partialFiles,
  refusalOf,
  send,
  sendAll,
  setup,
  start,
} from './upload-chunks.fixtures.mjs';

const CONTENT = Buffer.from('0123456789abcdef');
const MIB = 1024 * 1024;

test('an upload starts empty, receiving, with the chunk ceiling', async () => {
  const { rootDir, sessions } = await setup();
  const upload = await start(sessions, DB, CONTENT);
  assert.match(upload.uploadId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    { ...upload, uploadId: undefined },
    {
      uploadId: undefined,
      filename: DB,
      sizeBytes: 16,
      receivedBytes: 0,
      maxChunkBytes: 16 * MIB,
      state: 'receiving',
      code: null,
    },
  );
  assert.deepEqual(await partialFiles(rootDir), [upload.uploadId, `${upload.uploadId}.json`]);
});

test('a start is refused by its name, its size, its fingerprint, and the disk', async () => {
  const { sessions } = await setup({ maxUploadBytes: 100 });
  const ok = { filename: DB, sizeBytes: 10, fingerprint: 'a'.repeat(64) };
  assert.equal(
    (await refusalOf(sessions.create({ ...ok, filename: 'notes.txt' }))).code,
    'upload_bad_name',
  );
  assert.equal((await refusalOf(sessions.create({ ...ok, sizeBytes: 0 }))).code, 'upload_bad_size');
  assert.equal(
    (await refusalOf(sessions.create({ ...ok, sizeBytes: 1.5 }))).code,
    'upload_bad_size',
  );
  assert.deepEqual(await refusalOf(sessions.create({ ...ok, sizeBytes: 101 })), {
    status: 413,
    code: 'file_too_large',
    details: { maxBytes: 100 },
  });
  assert.equal(
    (await refusalOf(sessions.create({ ...ok, fingerprint: 'xyz' }))).code,
    'upload_bad_fingerprint',
  );
});

test('the disk must hold the file, what other uploads still owe, and the safety-net backup', async () => {
  // 16 owed by the open db upload + 16 for this file + 10 safety net + 16 to extract images.
  const { sessions } = await setup({ free: 57, safety: 10 });
  await start(sessions, DB, CONTENT);
  assert.deepEqual(await refusalOf(start(sessions, STORAGE, CONTENT)), {
    status: 400,
    code: 'upload_no_space',
    details: { freeBytes: 57, neededBytes: 58 },
  });

  const { sessions: roomy } = await setup({ free: 58, safety: 10 });
  await start(roomy, DB, CONTENT);
  assert.equal((await start(roomy, STORAGE, CONTENT)).state, 'receiving');
});

test('chunks land at their offset; the next offset is the one the server holds', async () => {
  const { rootDir, sessions } = await setup();
  const { uploadId } = await start(sessions, DB, CONTENT);
  assert.deepEqual(await send(sessions, uploadId, 0, CONTENT.subarray(0, 5)), { receivedBytes: 5 });
  assert.deepEqual(await refusalOf(send(sessions, uploadId, 0, CONTENT.subarray(0, 5))), {
    status: 409,
    code: 'upload_out_of_order',
    details: { receivedBytes: 5 },
  });
  await send(sessions, uploadId, 5, CONTENT.subarray(5));
  assert.equal((await sessions.status(uploadId)).receivedBytes, 16);
  assert.deepEqual(await readFile(path.join(partialDir(rootDir), uploadId)), CONTENT);
});

test('a chunk is refused before its body is read: offset, length, past the end, unknown id', async () => {
  const { sessions } = await setup();
  const { uploadId } = await start(sessions, DB, CONTENT);
  let read = 0;
  const reader = async () => {
    read += 1;
    return Buffer.alloc(0);
  };
  const codes = [];
  for (const [id, offset, length] of [
    [uploadId, '-1', 4],
    [uploadId, '1e3', 4],
    [uploadId, '0', undefined],
    [uploadId, '0', 16 * MIB + 1],
    [uploadId, '0', 17],
    [uploadId, '0', 0],
    ['00000000-0000-4000-8000-000000000000', '0', 4],
  ]) {
    const refused = await refusalOf(sessions.receive(id, offset, length, reader));
    codes.push(`${refused.status} ${refused.code}`);
  }
  assert.deepEqual(codes, [
    '400 upload_bad_offset',
    '400 upload_bad_offset',
    '411 upload_length_required',
    '413 file_too_large',
    '400 upload_chunk_size',
    '400 upload_chunk_size',
    '404 upload_gone',
  ]);
  assert.equal(read, 0);
});

test('a body that ends short is never written, and the upload resumes from where it was', async () => {
  const { rootDir, sessions } = await setup();
  const { uploadId } = await start(sessions, DB, CONTENT);
  await send(sessions, uploadId, 0, CONTENT.subarray(0, 4));
  const gone = sessions.receive(uploadId, '4', 4, async () => {
    throw new Error('aborted');
  });
  await assert.rejects(gone, /aborted/);
  const short = sessions.receive(uploadId, '4', 4, async () => CONTENT.subarray(4, 6));
  assert.equal((await refusalOf(short)).code, 'upload_chunk_size');
  assert.equal((await sessions.status(uploadId)).receivedBytes, 4);
  assert.equal((await readFile(path.join(partialDir(rootDir), uploadId))).length, 4);
});

test('bytes written past the recorded offset (a crash before the JSON) are overwritten', async () => {
  const { rootDir, sessions } = await setup();
  const { uploadId } = await start(sessions, DB, CONTENT);
  await send(sessions, uploadId, 0, CONTENT.subarray(0, 4));
  await writeFile(path.join(partialDir(rootDir), uploadId), Buffer.from('0123XXXXXX'));
  await send(sessions, uploadId, 4, CONTENT.subarray(4));
  assert.deepEqual(await readFile(path.join(partialDir(rootDir), uploadId)), CONTENT);
});

test('two chunks for one offset run one after the other: one lands, one is out of order', async () => {
  const { sessions } = await setup();
  const { uploadId } = await start(sessions, DB, CONTENT);
  const results = await Promise.allSettled([
    send(sessions, uploadId, 0, CONTENT.subarray(0, 8)),
    send(sessions, uploadId, 0, CONTENT.subarray(0, 8)),
  ]);
  assert.deepEqual(
    results.map((result) => result.status),
    ['fulfilled', 'rejected'],
  );
  assert.equal(results[1].reason.code, 'upload_out_of_order');
});

test('Cancel waits for a chunk in flight, then leaves nothing behind', async () => {
  const { rootDir, sessions } = await setup();
  const { uploadId } = await start(sessions, DB, CONTENT);
  let release;
  const body = new Promise((resolve) => {
    release = resolve;
  });
  const chunk = sessions.receive(uploadId, '0', 4, () => body);
  const cancel = sessions.cancel(uploadId);
  release(CONTENT.subarray(0, 4));
  await chunk;
  await cancel;
  assert.deepEqual(await partialFiles(rootDir), []);
  assert.equal((await refusalOf(send(sessions, uploadId, 4, CONTENT))).code, 'upload_gone');
});

test('after Delete all a chunk reads gone and writes no JSON back', async () => {
  const { rootDir, sessions } = await setup();
  const { uploadId } = await start(sessions, DB, CONTENT);
  const wipe = await removeAllUploads(rootDir);
  assert.equal(wipe.deletedSets, 0, 'the open uploads are no night');
  assert.equal((await refusalOf(send(sessions, uploadId, 0, CONTENT))).code, 'upload_gone');
  assert.deepEqual(await partialFiles(rootDir), []);
});

test('a chunk whose bytes file went is gone, and its JSON goes with it', async () => {
  const { rootDir, sessions } = await setup();
  const { uploadId } = await start(sessions, DB, CONTENT);
  await rm(path.join(partialDir(rootDir), uploadId));
  assert.equal((await refusalOf(send(sessions, uploadId, 0, CONTENT))).code, 'upload_gone');
  assert.deepEqual(await partialFiles(rootDir), []);
});

test('a JSON with no bytes (a wipe raced a chunk) is swept, and a start of that file replaces it', async () => {
  const { rootDir, sessions } = await setup();
  const first = await start(sessions, DB, CONTENT);
  await send(sessions, first.uploadId, 0, CONTENT.subarray(0, 4));
  await rm(path.join(partialDir(rootDir), first.uploadId));
  const again = await start(sessions, DB, CONTENT);
  assert.notEqual(again.uploadId, first.uploadId);
  assert.deepEqual(await partialFiles(rootDir), [again.uploadId, `${again.uploadId}.json`]);
});

test('a half-written JSON temp is left alone while running, and swept at boot', async () => {
  const { rootDir, sessions } = await setup();
  const { uploadId } = await start(sessions, DB, CONTENT);
  const temp = `${uploadId}.json.tmp`;
  await writeFile(path.join(partialDir(rootDir), temp), '{');
  await sessions.sweep();
  assert.ok((await partialFiles(rootDir)).includes(temp));
  await sessions.sweep({ boot: true });
  assert.ok(!(await partialFiles(rootDir)).includes(temp));
});

test('a start with no body is a bad name, not a fault', async () => {
  const { sessions } = await setup();
  assert.deepEqual(await refusalOf(sessions.create(null)), {
    status: 400,
    code: 'upload_bad_name',
    details: undefined,
  });
});

test('the same file again resumes the open upload; another file of that name replaces it', async () => {
  const { rootDir, sessions } = await setup({ fingerprintBytes: 4 });
  const first = await start(sessions, DB, CONTENT, 4);
  await send(sessions, first.uploadId, 0, CONTENT.subarray(0, 8));

  const again = await start(sessions, DB, CONTENT, 4);
  assert.equal(again.uploadId, first.uploadId);
  assert.equal(again.receivedBytes, 8);

  const other = Buffer.from('fedcba9876543210');
  const replaced = await start(sessions, DB, other, 4);
  assert.notEqual(replaced.uploadId, first.uploadId);
  assert.equal((await refusalOf(sessions.status(first.uploadId))).code, 'upload_gone');
  assert.deepEqual(await partialFiles(rootDir), [replaced.uploadId, `${replaced.uploadId}.json`]);
});

test('a resume checks the bytes the server holds against the fingerprint', async () => {
  const { rootDir, sessions } = await setup({ fingerprintBytes: 4 });
  const first = await start(sessions, DB, CONTENT, 4);
  await send(sessions, first.uploadId, 0, CONTENT.subarray(0, 8));
  // The bytes on disk are not the file's first bytes any more (a different file, same claim).
  await writeFile(path.join(partialDir(rootDir), first.uploadId), Buffer.from('XXXX4567'));
  const again = await start(sessions, DB, CONTENT, 4);
  assert.notEqual(again.uploadId, first.uploadId);
  assert.equal(again.receivedBytes, 0);
});

test('a resume below the fingerprint length is taken unchecked', async () => {
  const { sessions } = await setup({ fingerprintBytes: 8 });
  const first = await start(sessions, DB, CONTENT, 8);
  await send(sessions, first.uploadId, 0, CONTENT.subarray(0, 4));
  const again = await start(sessions, DB, CONTENT, 8);
  assert.equal(again.uploadId, first.uploadId);
});

test('a resume needs disk for the bytes it still owes, not the whole file', async () => {
  // Free 10: the whole file (16) would not fit, the 8 bytes still owed do.
  let free = 1e12;
  const { sessions } = await setup({ fingerprintBytes: 4, free: () => free });
  const first = await start(sessions, DB, CONTENT, 4);
  await send(sessions, first.uploadId, 0, CONTENT.subarray(0, 8));
  free = 10;
  assert.equal((await start(sessions, DB, CONTENT, 4)).uploadId, first.uploadId);
  assert.deepEqual(await refusalOf(start(sessions, DB, Buffer.from('fedcba9876543210'), 4)), {
    status: 400,
    code: 'upload_no_space',
    details: { freeBytes: 10, neededBytes: 16 },
  });
});

test('the sweep removes what is older than 24 h, and bytes with no JSON', async () => {
  const { rootDir, clock, sessions } = await setup();
  const old = await start(sessions, DB, CONTENT);
  clock.now = new Date(clock.now.getTime() + DAY_MS - 1000);
  const fresh = await start(sessions, STORAGE, CONTENT);
  await writeFile(path.join(partialDir(rootDir), 'orphan-bytes'), 'x');
  clock.now = new Date(clock.now.getTime() + 2000);
  await sessions.sweep();
  assert.deepEqual(await partialFiles(rootDir), [fresh.uploadId, `${fresh.uploadId}.json`]);
  assert.equal((await refusalOf(sessions.status(old.uploadId))).code, 'upload_gone');
});

test('a whole file sent in chunks is all received', async () => {
  const { sessions } = await setup();
  const { uploadId } = await start(sessions, DB, CONTENT);
  await sendAll(sessions, uploadId, CONTENT, 5);
  assert.equal((await sessions.status(uploadId)).receivedBytes, 16);
});
