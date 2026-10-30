import { createHash } from 'node:crypto';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withOpsLock } from './ops-lock.mjs';
import { createUploadSessions } from './upload-chunks.mjs';

/** Shared by the two upload-chunks test files (each stays under the file-size budget). */
export const NIGHT = '20261030T030000Z';
export const DB = `db-${NIGHT}.sql.gz`;
export const STORAGE = `storage-${NIGHT}.tar.gz`;
export const DAY_MS = 24 * 60 * 60 * 1000;

export function fingerprintOf(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * A temp root and a sessions object over it. `options`: free disk, the safety-net size, the
 * gzip check's verdict (or a function), the fingerprint length, the clock.
 */
export async function setup(options = {}) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'upload-chunks-'));
  const clock = { now: new Date('2026-10-30T22:00:00Z') };
  const verified = [];
  const sessions = createUploadSessions({
    rootDir,
    maxUploadBytes: options.maxUploadBytes ?? 10_000,
    freeBytes: async () =>
      typeof options.free === 'function' ? options.free() : (options.free ?? 1e12),
    safetyNetBytes: async () => options.safety ?? 0,
    verify: async (file) => {
      verified.push(file);
      return typeof options.verify === 'function' ? options.verify(file) : (options.verify ?? true);
    },
    withLock: (fn) =>
      options.withLock ? options.withLock(fn) : withOpsLock(rootDir, { kind: 'upload' }, fn),
    now: () => clock.now,
    fingerprintBytes: options.fingerprintBytes,
  });
  return { rootDir, clock, verified, sessions };
}

export function partialDir(rootDir) {
  return path.join(rootDir, 'backups', 'uploads', '.partial');
}

export async function partialFiles(rootDir) {
  return (await readdir(partialDir(rootDir)).catch(() => [])).sort();
}

/** Start an upload of `content` under `filename`; the fingerprint covers its first `length`. */
export function start(sessions, filename, content, length = 1024 * 1024) {
  return sessions.create({
    filename,
    sizeBytes: content.length,
    fingerprint: fingerprintOf(content.subarray(0, Math.min(content.length, length))),
  });
}

/** One chunk, as the HTTP layer hands it in: the offset text, the length, the body reader. */
export function send(sessions, id, offset, bytes) {
  return sessions.receive(id, String(offset), bytes.length, async () => bytes);
}

/** Send every byte of `content` in chunks of `size`. */
export async function sendAll(sessions, id, content, size = 4) {
  for (let offset = 0; offset < content.length; offset += size) {
    await send(sessions, id, offset, content.subarray(offset, offset + size));
  }
}

/** The refusal `promise` rejects with, as the HTTP layer reads it. */
export async function refusalOf(promise) {
  try {
    await promise;
  } catch (error) {
    return { status: error.statusCode, code: error.code, details: error.details };
  }
  throw new Error('expected a refusal');
}
