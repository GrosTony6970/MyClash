import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { createPinnedReader, isMissingPinnedFile, MISSING_PINNED_FILE } from './pinned-file.mjs';

const root = process.cwd();
const realFile = join(root, 'package.json');
const renamedFile = join(root, 'apps', 'web-public', 'app', 'page.tsx.this-was-renamed');
const notADirectory = join(root, 'package.json', 'nested');

test('a present file reads exactly as readFile would', async () => {
  const reader = createPinnedReader(root);

  assert.equal(await reader.readPinnedFile(realFile), await readFile(realFile, 'utf8'));
  assert.deepEqual(reader.missing, []);
  assert.deepEqual([...reader.read], ['package.json']);
});

test('the same file reached twice counts once', async () => {
  // A gate may open one file by two routes — check-infra-review.mjs reads
  // deploy.sh by its own constant and again while enumerating infra/scripts.
  // A count reported to the operator as "N files" has to mean N files.
  const reader = createPinnedReader(root);

  await reader.readPinnedFile(realFile);
  await reader.readPinnedFile(realFile);

  assert.equal(reader.read.size, 1);
});

test('an absent path is never counted as read', async () => {
  const reader = createPinnedReader(root);

  await reader.readPinnedFile(renamedFile);
  await reader.readPinnedDir(join(root, 'packages', 'i18n', 'src', 'gone'));

  assert.equal(reader.read.size, 0);
  assert.equal(reader.missing.length, 2);
});

test('a renamed file is reported, not thrown', async () => {
  const reader = createPinnedReader(root);

  // The whole point: this call must RETURN. Falsifies the fix — the spelling
  // check-infra-review.mjs used to carry throws ENOENT from node:internal here,
  // which took the other 400-odd assertions down with it.
  const text = await reader.readPinnedFile(renamedFile);

  assert.ok(isMissingPinnedFile(text));
  assert.deepEqual(reader.missing, ['apps/web-public/app/page.tsx.this-was-renamed']);
  await assert.rejects(() => readFile(renamedFile, 'utf8'), { code: 'ENOENT' });
});

test('the sentinel answers "not found" to every read a gate performs on it', () => {
  // Gates do more than includes() on these texts. Each of these must report
  // absence rather than throw, or the crash simply moves to the call site.
  assert.equal(MISSING_PINNED_FILE.includes('healthcheck:'), false);
  assert.equal(/traefik\.http\.routers\./u.test(MISSING_PINNED_FILE), false);
  assert.equal(MISSING_PINNED_FILE.match(/^\s+image:\s+(\S+)/mu), null);
  assert.deepEqual([...MISSING_PINNED_FILE.matchAll(/allowlist\.ip=([^\n]*)/gu)], []);
  assert.equal(MISSING_PINNED_FILE.indexOf('hdr "Deploy complete"'), -1);
  assert.equal(MISSING_PINNED_FILE.slice(-1).length, 1);
  assert.equal(MISSING_PINNED_FILE.split(/\r?\n/u).length, 1);
});

test('the sentinel cannot be a substring of real source', () => {
  // It is NUL-wrapped so no assertion string can match it and no real file can
  // produce it. A plain marker like 'MISSING' would be findable in source and
  // would let a gate silently assert against absence.
  assert.ok(MISSING_PINNED_FILE.startsWith(String.fromCharCode(0)));
  assert.equal(isMissingPinnedFile(''), false);
  assert.equal(isMissingPinnedFile('myclash:missing-pinned-file'), false);
});

test('a path whose parent is a file is absent, not a crash', async () => {
  const reader = createPinnedReader(root);

  assert.ok(isMissingPinnedFile(await reader.readPinnedFile(notADirectory)));
  assert.deepEqual(reader.missing, ['package.json/nested']);
});

test('reading a directory as a file is absent, not a crash', async () => {
  // EISDIR. Compose creates a DIRECTORY at a bind source whose file is missing,
  // so a gate pointed at that path meets a directory where it wanted text.
  const reader = createPinnedReader(root);

  assert.ok(isMissingPinnedFile(await reader.readPinnedFile(join(root, 'scripts'))));
  assert.deepEqual(reader.missing, ['scripts']);
});

test('a missing directory yields no entries and is reported once', async () => {
  const reader = createPinnedReader(root);

  assert.deepEqual(await reader.readPinnedDir(join(root, 'packages', 'i18n', 'src', 'gone')), []);
  assert.deepEqual(reader.missing, ['packages/i18n/src/gone']);
});

test('a present directory lists entries and records nothing', async () => {
  const reader = createPinnedReader(root);

  assert.ok((await reader.readPinnedDir(join(root, 'scripts', 'lib'))).includes('pinned-file.mjs'));
  assert.deepEqual(reader.missing, []);
});

test('every missing path is recorded, in read order', async () => {
  // One finding per absent path, so a gate can name all of them in one run
  // instead of stopping at the first.
  const reader = createPinnedReader(root);

  await reader.readPinnedFile(join(root, 'infra', 'gone-a.yml'));
  await reader.readPinnedFile(realFile);
  await reader.readPinnedFile(join(root, 'apps', 'api', 'gone-b.ts'));

  assert.deepEqual(reader.missing, ['infra/gone-a.yml', 'apps/api/gone-b.ts']);
});

test('an error that is not absence is rethrown and recorded nowhere', async () => {
  // EACCES and friends are not facts about the repo. Swallowing them would let
  // a gate report "this file was renamed" for a file that is present and
  // unreadable — a wrong finding is worse than a crash, because someone acts on
  // it. Only the absence codes may become a `missing` entry.
  const reader = createPinnedReader(root);

  await assert.rejects(() => reader.readPinnedFile(42), { code: 'ERR_INVALID_ARG_TYPE' });
  await assert.rejects(() => reader.readPinnedDir(42), { code: 'ERR_INVALID_ARG_TYPE' });
  assert.deepEqual(reader.missing, []);
});
