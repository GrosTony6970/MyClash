import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BACKUP_FILENAME_PATTERN, parseBackupFilename } from './backup-core.mjs';
import { FAILED_CODE, complete, idle, recover, startJob } from './upload-finish.mjs';
import {
  MAX_CHUNK_BYTES,
  bytesPath,
  exists,
  gone,
  listSessions,
  notReceiving,
  partialRoot,
  publicView,
  readSession,
  removeSession,
  serialize,
  throwGone,
  writeSession,
} from './upload-session-files.mjs';
import { refusal } from './upload-store.mjs';

export { MAX_CHUNK_BYTES, UPLOAD_SESSION_ID_PATTERN } from './upload-session-files.mjs';

/**
 * A backup uploaded in chunks (ruling 216): Traefik reads a request body for 60 s at most, so a
 * 2 GB file (ruling 212) arrives as many small requests. One open upload is `.partial/<id>` (the
 * bytes, written in place at each chunk's offset) and `.partial/<id>.json` (where it is):
 *
 *   receiving → verifying → staging → staged          (or verifying → failed)
 *
 * Every writer of one upload's files runs on that upload's own queue (`serialize`): a chunk,
 * complete and its background end (`upload-finish.mjs`), Cancel, the sweep. Starts run on one
 * queue of their own (two tabs starting one file name). A chunk's bytes are made durable BEFORE
 * its JSON says they are there, so a crash between the two leaves the JSON behind and the next
 * chunk overwrites them. The same file started again resumes its open upload (ruling 219).
 *
 * `deps` = { rootDir, maxUploadBytes, freeBytes, safetyNetBytes, verify, withLock, now,
 * fingerprintBytes? }. Pure file work over them, so it is tested on a temp dir.
 */
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const OFFSET_PATTERN = /^\d+$/;
const STALE_MS = 24 * 60 * 60 * 1000;
const START_QUEUE = 'start';

export function createUploadSessions(deps) {
  const ctx = {
    ...deps,
    fingerprintBytes: deps.fingerprintBytes ?? 1024 * 1024,
    queues: new Map(),
    jobs: new Map(),
  };
  return {
    create: (input) => serialize(ctx, START_QUEUE, () => create(ctx, input)),
    receive: (id, offset, length, read) => receive(ctx, id, offset, length, read),
    status: async (id) => publicView((await readSession(ctx, id)) ?? throwGone()),
    complete: (id) => serialize(ctx, id, () => complete(ctx, id)),
    cancel: (id) => serialize(ctx, id, () => cancel(ctx, id)),
    sweep: (options) => sweep(ctx, options),
    idle: () => idle(ctx),
  };
}

function checkStart(ctx, { filename, sizeBytes, fingerprint }) {
  if (!BACKUP_FILENAME_PATTERN.test(String(filename))) {
    throw refusal(400, 'Unsupported backup filename.', 'upload_bad_name');
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw refusal(400, 'Invalid upload size.', 'upload_bad_size');
  }
  if (sizeBytes > ctx.maxUploadBytes) {
    throw refusal(413, 'Backup upload exceeds the configured size limit.', 'file_too_large', {
      maxBytes: ctx.maxUploadBytes,
    });
  }
  if (!FINGERPRINT_PATTERN.test(String(fingerprint))) {
    throw refusal(400, 'Invalid upload fingerprint.', 'upload_bad_fingerprint');
  }
}

/** A start: the same file again resumes its open upload (ruling 219), else a new upload. */
async function create(ctx, body) {
  const input = body && typeof body === 'object' ? body : {};
  checkStart(ctx, input);
  await sweep(ctx);
  const resumed = await settleSameName(ctx, input);
  await assertRoom(ctx, input, resumed);
  if (resumed) {
    // A failure that was not the file's (`upload_failed`) resumes as receiving: complete again.
    const { error: _error, ...rest } = resumed;
    const receiving = { ...rest, state: 'receiving', code: null, verified: false };
    return publicView(await writeSession(ctx, receiving));
  }
  const session = {
    id: randomUUID(),
    filename: input.filename,
    sizeBytes: input.sizeBytes,
    fingerprint: input.fingerprint,
    receivedBytes: 0,
    state: 'receiving',
  };
  await mkdir(partialRoot(ctx), { recursive: true });
  await writeFile(bytesPath(ctx, session.id), '');
  return publicView(await writeSession(ctx, session));
}

/**
 * The uploads of the same file name: one being checked or moved makes the start wait (409); the
 * same file still receiving (or failed through no fault of its bytes) is resumed; any other
 * (staged, corrupt, another file) is removed.
 */
async function settleSameName(ctx, wanted) {
  const same = (await listSessions(ctx)).filter((s) => s.filename === wanted.filename);
  if (same.some(busy)) throw notReceiving();
  let resumed = null;
  for (const session of same) {
    const keep =
      !resumed &&
      (session.state === 'receiving' || session.code === FAILED_CODE) &&
      session.sizeBytes === wanted.sizeBytes &&
      session.fingerprint === wanted.fingerprint &&
      (await holdsFingerprint(ctx, session));
    if (keep) resumed = session;
    else await serialize(ctx, session.id, () => removeSession(ctx, session.id));
  }
  return resumed;
}

/**
 * Being checked or moved. A `complete` landing between the list and a removal is not re-checked:
 * the removal waits on the upload's queue, so it never runs mid-move; that tab reads "gone".
 */
function busy(session) {
  return session.state === 'verifying' || session.state === 'staging';
}

/**
 * The bytes the server holds start as the file claims; fewer than the fingerprint: unchecked. A
 * JSON with no bytes never gets here: the start's sweep removed it first.
 */
async function holdsFingerprint(ctx, session) {
  const length = Math.min(ctx.fingerprintBytes, session.sizeBytes);
  if (session.receivedBytes < length) return true;
  const handle = await open(bytesPath(ctx, session.id), 'r');
  try {
    const head = Buffer.alloc(length);
    await handle.read(head, 0, length, 0);
    return createHash('sha256').update(head).digest('hex') === session.fingerprint;
  } finally {
    await handle.close();
  }
}

/**
 * Room for what this upload still owes, what every other open upload owes, the safety-net backup
 * a restore writes first, and an images file once more (a restore extracts it into the volume).
 */
async function assertRoom(ctx, wanted, resumed) {
  const others = (await listSessions(ctx)).filter(
    (s) => s.state === 'receiving' && s.id !== resumed?.id,
  );
  const owed = others.reduce((sum, s) => sum + s.sizeBytes - s.receivedBytes, 0);
  const images = parseBackupFilename(wanted.filename)?.kind === 'storage' ? wanted.sizeBytes : 0;
  const neededBytes =
    wanted.sizeBytes - (resumed?.receivedBytes ?? 0) + owed + (await ctx.safetyNetBytes()) + images;
  const freeBytes = await ctx.freeBytes();
  if (freeBytes < neededBytes) {
    throw refusal(400, 'Not enough free disk space for this upload.', 'upload_no_space', {
      freeBytes,
      neededBytes,
    });
  }
}

function checkChunk(offsetText, length) {
  if (!OFFSET_PATTERN.test(String(offsetText))) {
    throw refusal(400, 'Invalid chunk offset.', 'upload_bad_offset');
  }
  if (length === undefined || length === null) {
    throw refusal(411, 'A chunk needs a Content-Length.', 'upload_length_required');
  }
  if (length > MAX_CHUNK_BYTES) {
    throw refusal(413, 'A chunk exceeds the chunk size limit.', 'file_too_large', {
      maxBytes: MAX_CHUNK_BYTES,
    });
  }
  return Number(offsetText);
}

/** One chunk: refused before its body is read, else written at its offset, then recorded. */
async function receive(ctx, id, offsetText, length, read) {
  const offset = checkChunk(offsetText, length);
  return serialize(ctx, id, async () => {
    const session = (await readSession(ctx, id)) ?? throwGone();
    if (session.state !== 'receiving') throw notReceiving();
    if (offset !== session.receivedBytes) {
      throw refusal(409, 'This chunk is out of order.', 'upload_out_of_order', {
        receivedBytes: session.receivedBytes,
      });
    }
    if (length <= 0 || offset + length > session.sizeBytes) throw badChunkSize();
    const bytes = await read(length);
    if (bytes.length !== length) throw badChunkSize();
    await writeAt(ctx, id, bytes, offset);
    const record = { ...session, receivedBytes: offset + length, code: null };
    await writeSession(ctx, record);
    return { receivedBytes: record.receivedBytes };
  });
}

function badChunkSize() {
  return refusal(400, 'This chunk does not fit the upload.', 'upload_chunk_size');
}

/** In place, then `datasync`: the bytes are on disk before the JSON says so. */
async function writeAt(ctx, id, bytes, offset) {
  let handle;
  try {
    handle = await open(bytesPath(ctx, id), 'r+');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await removeSession(ctx, id);
    throw gone();
  }
  try {
    await handle.write(bytes, 0, bytes.length, offset);
    await handle.datasync();
  } finally {
    await handle.close();
  }
}

async function cancel(ctx, id) {
  const session = (await readSession(ctx, id)) ?? throwGone();
  if (session.state === 'verifying' || session.state === 'staging') throw notReceiving();
  await removeSession(ctx, id);
  return { cancelled: true, uploadId: id };
}

/**
 * What is older than 24 h goes, bytes with no JSON, and a receiving JSON with no bytes (a wipe
 * raced a chunk). At boot (before the server listens) a check that died with the process goes
 * back to `receiving`, and a `staging` mark is recovered, however old: its bytes may be a whole
 * night the runner was down for.
 */
async function sweep(ctx, { boot = false } = {}) {
  const entries = await readdir(partialRoot(ctx)).catch(() => []);
  const kept = new Set();
  for (const id of entries.filter((e) => e.endsWith('.json')).map((e) => e.slice(0, -5))) {
    await serialize(ctx, id, async () => {
      const session = await readSession(ctx, id);
      if (!session || (await expired(ctx, session, boot))) return removeSession(ctx, id);
      kept.add(id);
      if (boot && session.state === 'verifying') {
        await writeSession(ctx, { ...session, state: 'receiving' });
      }
      if (boot && session.state === 'staging') startJob(ctx, id, () => recover(ctx, id));
    });
  }
  for (const entry of entries) {
    const temp = entry.endsWith('.tmp');
    if (entry.endsWith('.json') || kept.has(entry) || (temp && !boot)) continue;
    await rm(path.join(partialRoot(ctx), entry), { force: true });
  }
}

async function expired(ctx, session, boot) {
  if (boot && session.state === 'staging') return false;
  if (session.state === 'receiving' && !(await exists(bytesPath(ctx, session.id)))) return true;
  return ctx.now() - Date.parse(session.updatedAt) > STALE_MS;
}
