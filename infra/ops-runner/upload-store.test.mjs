import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { backupSetsFromArtifacts } from './backup-core.mjs';
import {
  incomingPath,
  listUploadArtifacts,
  removeAllUploads,
  removeUploadFiles,
  removeUploadSet,
  resolveUploadSet,
  restoreArgs,
  stageUpload,
  sweepIncoming,
} from './upload-store.mjs';

const NIGHT = '20261030T030000Z';
const DB = `db-${NIGHT}.sql.gz`;
const STORAGE = `storage-${NIGHT}.tar.gz`;
const passes = async () => true;

async function root() {
  return mkdtemp(path.join(tmpdir(), 'upload-store-'));
}

function night(rootDir, ts = NIGHT) {
  return path.join(rootDir, 'backups', 'uploads', ts);
}

/** What the base64 adapter does: write the bytes to the night's incoming file, then stage it. */
async function upload(rootDir, filename, content, verify = passes) {
  const ts = /\d{8}T\d{6}Z/.exec(filename)?.[0] ?? NIGHT;
  const temp = await incomingPath(rootDir, ts);
  await writeFile(temp, content);
  return stageUpload(rootDir, filename, temp, { verify });
}

async function refusal(promise) {
  await assert.rejects(promise, (error) => error.statusCode === 400);
}

test('an upload lands in its night folder and answers its set', async () => {
  const rootDir = await root();
  const { backup } = await upload(rootDir, DB, 'db');
  assert.deepEqual(await readdir(night(rootDir)), [DB]);
  assert.equal(backup.id, `upload-${NIGHT}`);
  assert.equal(backup.timestamp, NIGHT);
  assert.deepEqual(
    backup.upload.artifacts.map((artifact) => artifact.filename),
    [DB],
  );
});

test('the database and the images of one night are one set', async () => {
  const rootDir = await root();
  await upload(rootDir, DB, 'db');
  const { backup } = await upload(rootDir, STORAGE, 'images');
  assert.deepEqual(backup.upload.artifacts.map((artifact) => artifact.filename).sort(), [
    DB,
    STORAGE,
  ]);
  const sets = backupSetsFromArtifacts({ uploadArtifacts: await listUploadArtifacts(rootDir) });
  assert.equal(sets.length, 1);
  assert.equal(sets[0].id, `upload-${NIGHT}`);
  assert.equal(sets[0].upload.artifacts.length, 2);
});

test('a second upload of the same kind and night replaces the first (ruling 213)', async () => {
  const rootDir = await root();
  await upload(rootDir, DB, 'first');
  await upload(rootDir, DB, 'second');
  assert.deepEqual(await readdir(night(rootDir)), [DB]);
  assert.equal(await readFile(path.join(night(rootDir), DB), 'utf8'), 'second');
});

test('an encrypted upload keeps the plain file of its kind, and the restore prefers the plain', async () => {
  const rootDir = await root();
  await upload(rootDir, DB, 'plain');
  let verified = 0;
  await upload(rootDir, `${DB}.gpg`, 'sealed', async () => {
    verified += 1;
    return false;
  });
  assert.equal(verified, 0, 'a .gpg cannot be gzip-tested without the key');
  assert.deepEqual((await readdir(night(rootDir))).sort(), [DB, `${DB}.gpg`]);
  const set = await resolveUploadSet(rootDir, `upload-${NIGHT}`);
  assert.equal(set.db, path.join(night(rootDir), DB));
});

test('a file that fails its check is refused and the earlier file stays', async () => {
  const rootDir = await root();
  await upload(rootDir, DB, 'good');
  await refusal(upload(rootDir, DB, 'broken', async () => false));
  assert.deepEqual(await readdir(night(rootDir)), [DB]);
  assert.equal(await readFile(path.join(night(rootDir), DB), 'utf8'), 'good');
});

test('a refused first file of a night leaves no folder behind', async () => {
  const rootDir = await root();
  await refusal(upload(rootDir, DB, 'broken', async () => false));
  assert.deepEqual(await readdir(path.join(rootDir, 'backups', 'uploads')), []);
});

test('a name that is not a backup file is refused before anything is written', async () => {
  const rootDir = await root();
  await refusal(incomingPath(rootDir, 'notes'));
  await refusal(stageUpload(rootDir, 'notes.txt', path.join(rootDir, 'x'), { verify: passes }));
  await refusal(stageUpload(rootDir, `../${DB}`, path.join(rootDir, 'x'), { verify: passes }));
  assert.equal(existsSync(path.join(rootDir, 'backups', 'uploads')), false);
});

test('the lister reads night folders only, and only the files of that night', async () => {
  const rootDir = await root();
  await upload(rootDir, DB, 'db');
  await writeFile(path.join(night(rootDir), '.incoming-abc'), 'partial');
  await writeFile(path.join(night(rootDir), 'db-20261029T030000Z.sql.gz'), 'other night');
  const oldLayout = path.join(rootDir, 'backups', 'uploads', `upload-${NIGHT}-abcd1234`);
  await mkdir(oldLayout, { recursive: true });
  await writeFile(path.join(oldLayout, DB), 'old layout');
  await writeFile(path.join(rootDir, 'backups', 'uploads', 'notes.txt'), 'not a night');
  const artifacts = await listUploadArtifacts(rootDir);
  assert.deepEqual(
    artifacts.map((artifact) => [artifact.uploadId, artifact.filename]),
    [[`upload-${NIGHT}`, DB]],
  );
  assert.deepEqual(await listUploadArtifacts(await root()), []);
});

test('the boot sweep removes the incoming files a crash left, and nothing else', async () => {
  const rootDir = await root();
  await upload(rootDir, DB, 'db');
  await writeFile(path.join(night(rootDir), '.incoming-abc'), 'partial');
  await sweepIncoming(rootDir);
  assert.deepEqual(await readdir(night(rootDir)), [DB]);
  await sweepIncoming(await root());
});

test('an unknown or malformed set is refused', async () => {
  const rootDir = await root();
  await refusal(resolveUploadSet(rootDir, `upload-${NIGHT}`));
  await refusal(resolveUploadSet(rootDir, `upload-${NIGHT}-abcd1234`));
  await refusal(resolveUploadSet(rootDir, NIGHT));
  await mkdir(night(rootDir), { recursive: true });
  await refusal(resolveUploadSet(rootDir, `upload-${NIGHT}`));
});

test('restoreArgs: the database and the images of the night restore together', () => {
  assert.deepEqual(restoreArgs({ db: '/b/db', storage: '/b/st' }, true), {
    args: ['/b/db', '--yes', '--storage-file', '/b/st'],
    used: ['/b/db', '/b/st'],
    scope: 'both',
  });
});

test('restoreArgs: a database alone, or with its images left out, restores the database only', () => {
  const dbOnly = { args: ['/b/db', '--yes', '--db-only'], used: ['/b/db'], scope: 'database' };
  assert.deepEqual(restoreArgs({ db: '/b/db', storage: null }, true), dbOnly);
  assert.deepEqual(restoreArgs({ db: '/b/db', storage: '/b/st' }, false), dbOnly);
});

test('restoreArgs: the images alone restore the images only (ruling 215)', () => {
  assert.deepEqual(restoreArgs({ db: null, storage: '/b/st' }, true), {
    args: ['--storage-only', '/b/st', '--yes'],
    used: ['/b/st'],
    scope: 'images',
  });
  assert.throws(
    () => restoreArgs({ db: null, storage: '/b/st' }, false),
    (error) => error.statusCode === 400,
  );
});

test('restoreArgs: a night that changed since the dialog is refused, never restored', () => {
  const both = { db: '/b/db', storage: '/b/st' };
  // The dialog said "images only"; a database arrived from another tab since.
  assert.throws(
    () => restoreArgs(both, true, 'images'),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () => restoreArgs({ db: '/b/db', storage: null }, true, 'both'),
    (error) => error.statusCode === 400,
  );
  assert.equal(restoreArgs(both, true, 'both').scope, 'both');
  assert.equal(restoreArgs(both, false, 'database').scope, 'database');
});

test('after a restore only the files it used are deleted, then the folder when empty', async () => {
  const rootDir = await root();
  await upload(rootDir, DB, 'db');
  await upload(rootDir, STORAGE, 'images');
  await removeUploadFiles(rootDir, [path.join(night(rootDir), DB)]);
  assert.deepEqual(await readdir(night(rootDir)), [STORAGE]);
  await removeUploadFiles(rootDir, [path.join(night(rootDir), STORAGE)]);
  assert.equal(existsSync(night(rootDir)), false);
});

test('a set is deleted whole (ruling 218), and an unknown set is refused', async () => {
  const rootDir = await root();
  await upload(rootDir, DB, 'db');
  await upload(rootDir, STORAGE, 'images');
  await writeFile(path.join(night(rootDir), 'db-20261029T030000Z.sql.gz'), 'not this night');
  const deleted = await removeUploadSet(rootDir, `upload-${NIGHT}`);
  assert.deepEqual(deleted.sort(), [DB, STORAGE], 'the files of the set, as the list showed it');
  assert.equal(existsSync(night(rootDir)), false);
  await refusal(removeUploadSet(rootDir, `upload-${NIGHT}`));
});

test('delete all removes every upload, the old layout too', async () => {
  const rootDir = await root();
  await upload(rootDir, DB, 'db');
  await upload(rootDir, 'db-20261029T030000Z.sql.gz', 'db');
  const oldLayout = path.join(rootDir, 'backups', 'uploads', `upload-${NIGHT}-abcd1234`);
  await mkdir(oldLayout, { recursive: true });
  await writeFile(path.join(oldLayout, DB), 'old layout');
  const wipe = await removeAllUploads(rootDir);
  assert.equal(wipe.deletedSets, 3);
  assert.deepEqual(wipe.failedFiles, []);
  assert.deepEqual(await readdir(path.join(rootDir, 'backups', 'uploads')), []);
  assert.deepEqual(await removeAllUploads(await root()), {
    deletedSets: 0,
    deletedFiles: [],
    failedFiles: [],
  });
});
