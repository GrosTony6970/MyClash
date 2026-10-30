import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  BACKUP_TIMESTAMP_PATTERN,
  BACKUP_FILENAME_PATTERN,
  buildBackupSet,
  parseBackupFilename,
} from './backup-core.mjs';

/**
 * Backups uploaded from the admin screen: one folder per night, `backups/uploads/<ts>/`, holding
 * at most one file per kind and encryption (ruling 213: a new upload replaces its like). The set
 * id is `upload-<ts>`. Pure file work, so it is tested on a temp dir; server.mjs takes the ops
 * lock around every write here.
 */
export const UPLOAD_SET_ID_PATTERN = /^upload-(?<ts>\d{8}T\d{6}Z)$/;
const INCOMING_PREFIX = '.incoming-';

/**
 * A refusal the HTTP layer answers with `statusCode`, not as a server fault (the API relays the
 * class). Its `code` is one the screen words itself; `details` carries the numbers it names.
 */
export function refusal(statusCode, message, code, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  if (details) error.details = details;
  return error;
}

/** A refusal the HTTP layer answers as 400. */
export function badRequest(message, code) {
  return refusal(400, message, code);
}

/** A restore whose night changed since the dialog said what it restores. */
export const UPLOAD_CHANGED_CODE = 'upload_changed';

export function uploadsRoot(rootDir) {
  return path.join(rootDir, 'backups', 'uploads');
}

/** The open (chunked) uploads' folder: not a night, so the lister and the sweep skip it. */
export const PARTIAL_DIR = '.partial';

/** Where `stageUpload` keeps `filename` in its night's folder. */
export function stagedPath(rootDir, filename) {
  const parsed = parseUploadName(filename);
  return path.join(nightDir(rootDir, parsed.timestamp), parsed.filename);
}

function nightDir(rootDir, timestamp) {
  return path.join(uploadsRoot(rootDir), timestamp);
}

function parseUploadName(filename) {
  const name = String(filename ?? '');
  const parsed = BACKUP_FILENAME_PATTERN.test(name) ? parseBackupFilename(name) : null;
  if (!parsed) throw badRequest('Unsupported backup filename.');
  return parsed;
}

/** Where the caller writes an upload before `stageUpload` checks and keeps it. */
export async function incomingPath(rootDir, timestamp) {
  if (!BACKUP_TIMESTAMP_PATTERN.test(String(timestamp))) {
    throw badRequest('Unsupported backup filename.');
  }
  await mkdir(nightDir(rootDir, timestamp), { recursive: true });
  return path.join(nightDir(rootDir, timestamp), `${INCOMING_PREFIX}${randomUUID()}`);
}

/**
 * Keep the file the caller wrote at `sourcePath` as `filename` in its night's folder, replacing
 * the file of the same name. A plain file must pass `verify` (gzip -t); a `.gpg` cannot be read
 * without the key and is checked at restore time. A refused file is removed; the old one stays.
 *
 * @returns {Promise<{ backup: object }>} the night's whole set, as the list shows it.
 */
export async function stageUpload(rootDir, filename, sourcePath, { verify }) {
  const parsed = parseUploadName(filename);
  if (!parsed.encrypted && !(await verify(sourcePath))) {
    await discardIncoming(sourcePath);
    throw badRequest('Uploaded backup failed integrity check (corrupt or truncated gzip).');
  }
  await mkdir(nightDir(rootDir, parsed.timestamp), { recursive: true });
  await rename(sourcePath, path.join(nightDir(rootDir, parsed.timestamp), parsed.filename));
  return { backup: await nightSet(rootDir, parsed.timestamp) };
}

/** One night's whole set, as the list shows it. */
export async function nightSet(rootDir, timestamp) {
  const artifacts = await nightArtifacts(rootDir, timestamp);
  return buildBackupSet(uploadSetId(timestamp), timestamp, artifacts, 'upload');
}

/** A refused or broken incoming file goes, and its night's folder with it when that leaves it empty. */
export async function discardIncoming(file) {
  await rm(file, { force: true });
  await rmdir(path.dirname(file)).catch(() => undefined);
}

function uploadSetId(timestamp) {
  return `upload-${timestamp}`;
}

function setTimestamp(id) {
  const match = UPLOAD_SET_ID_PATTERN.exec(String(id));
  if (!match?.groups) throw badRequest('Invalid upload identifier.');
  return match.groups.ts;
}

async function readdirOrEmpty(dir) {
  try {
    return await readdir(dir);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

/** The backup files of one night's folder; anything else in it (an incoming file) is not one. */
async function nightArtifacts(rootDir, timestamp) {
  const artifacts = [];
  for (const entry of await readdirOrEmpty(nightDir(rootDir, timestamp))) {
    const parsed = parseBackupFilename(entry);
    if (!parsed || parsed.timestamp !== timestamp) continue;
    // Read without the lock: a file deleted since the readdir is simply not there any more.
    const fileStat = await stat(path.join(nightDir(rootDir, timestamp), entry)).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (!fileStat) continue;
    artifacts.push({
      ...parsed,
      uploadId: uploadSetId(timestamp),
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
    });
  }
  return artifacts;
}

/** Every uploaded file, for `backupSetsFromArtifacts`. Folders of the old layout are not nights. */
export async function listUploadArtifacts(rootDir) {
  const artifacts = [];
  for (const entry of await readdirOrEmpty(uploadsRoot(rootDir))) {
    if (BACKUP_TIMESTAMP_PATTERN.test(entry))
      artifacts.push(...(await nightArtifacts(rootDir, entry)));
  }
  return artifacts;
}

/** Remove what a crash left half-written. Run once at boot, before any upload can start. */
export async function sweepIncoming(rootDir) {
  for (const entry of await readdirOrEmpty(uploadsRoot(rootDir))) {
    if (!BACKUP_TIMESTAMP_PATTERN.test(entry)) continue;
    for (const file of await readdirOrEmpty(nightDir(rootDir, entry))) {
      if (file.startsWith(INCOMING_PREFIX)) {
        await rm(path.join(nightDir(rootDir, entry), file), { force: true });
      }
    }
  }
}

/**
 * The files of a set by kind, a plain file before an encrypted one (as `findLocalArtifact`).
 * @returns {Promise<{ timestamp: string, db: string | null, storage: string | null }>}
 */
export async function resolveUploadSet(rootDir, id) {
  const timestamp = setTimestamp(id);
  const artifacts = await nightArtifacts(rootDir, timestamp);
  const pick = (kind) => {
    const ofKind = artifacts.filter((artifact) => artifact.kind === kind);
    const chosen = ofKind.find((artifact) => !artifact.encrypted) ?? ofKind[0];
    return chosen ? path.join(nightDir(rootDir, timestamp), chosen.filename) : null;
  };
  const set = { timestamp, db: pick('db'), storage: pick('storage') };
  if (!set.db && !set.storage) throw badRequest('Uploaded backup not found.');
  return set;
}

/**
 * The `restore.sh` arguments for an upload set, the files they read (deleted after a successful
 * restore, ruling 214) and what the restore replaces (`scope`, as the screen's dialog says it:
 * 'both' | 'database' | 'images'). `includeStorage: false` keeps its meaning: database only.
 *
 * `expectedScope` is what the screen's dialog said. The night can change between the dialog and
 * the click (a file uploaded from another tab, ruling 213): a dialog that said "images only"
 * must never drop the database, so a different scope is refused.
 */
export function restoreArgs(set, includeStorage, expectedScope) {
  const planned = plannedRestore(set, includeStorage);
  if (expectedScope !== undefined && expectedScope !== planned.scope) {
    throw badRequest(
      'This upload changed since the page read it. Reload, then restore again.',
      UPLOAD_CHANGED_CODE,
    );
  }
  return planned;
}

function plannedRestore(set, includeStorage) {
  if (set.db && set.storage && includeStorage) {
    return {
      args: [set.db, '--yes', '--storage-file', set.storage],
      used: [set.db, set.storage],
      scope: 'both',
    };
  }
  if (set.db) return { args: [set.db, '--yes', '--db-only'], used: [set.db], scope: 'database' };
  if (set.storage && includeStorage) {
    return { args: ['--storage-only', set.storage, '--yes'], used: [set.storage], scope: 'images' };
  }
  throw badRequest('This upload has no database file to restore.');
}

/**
 * After a successful restore: remove the files it used, then their folder if nothing else is in
 * it — an images file uploaded for a database-only restore stays for its own restore.
 */
export async function removeUploadFiles(rootDir, files) {
  const folders = new Set();
  for (const file of files) {
    await rm(file, { force: true });
    folders.add(path.dirname(file));
  }
  for (const folder of folders) {
    if (path.dirname(folder) !== uploadsRoot(rootDir)) continue;
    await rmdir(folder).catch(() => undefined);
  }
}

/** Ruling 218: an upload row's Delete. @returns the file names removed. */
export async function removeUploadSet(rootDir, id) {
  const timestamp = setTimestamp(id);
  const files = (await readdirOrEmpty(nightDir(rootDir, timestamp))).filter(
    (entry) => parseBackupFilename(entry)?.timestamp === timestamp,
  );
  if (files.length === 0) throw badRequest('No backup artifacts found to delete.');
  await rm(nightDir(rootDir, timestamp), { recursive: true, force: true });
  return files;
}

/** "Delete all backups" clears the uploads too (ruling 218), the old layout's folders included. */
export async function removeAllUploads(rootDir) {
  const wipe = { deletedSets: 0, deletedFiles: [], failedFiles: [] };
  for (const entry of await readdirOrEmpty(uploadsRoot(rootDir))) {
    const target = path.join(uploadsRoot(rootDir), entry);
    const files = (await stat(target)).isDirectory() ? await readdirOrEmpty(target) : [entry];
    try {
      await rm(target, { recursive: true, force: true });
      // The open uploads go too (their next chunk reads `upload_gone`), but they are no night.
      if (entry === PARTIAL_DIR) continue;
      wipe.deletedSets += 1;
      wipe.deletedFiles.push(...files.filter((file) => parseBackupFilename(file)));
    } catch {
      wipe.failedFiles.push(entry);
    }
  }
  return wipe;
}
