import { readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PARTIAL_DIR, refusal, uploadsRoot } from './upload-store.mjs';

/**
 * The files of an open chunked upload (`upload-chunks.mjs`): `.partial/<id>` holds the bytes,
 * `.partial/<id>.json` where the upload is. Shared by the start / chunk side and the complete side.
 * `ctx` = the sessions' deps plus `queues` (one per upload) and `jobs` (the background ends).
 */
export const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
export const UPLOAD_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function gone() {
  return refusal(
    404,
    'This upload is gone: deleted, older than 24 hours, or replaced by another upload of the same file.',
    'upload_gone',
  );
}

export function throwGone() {
  throw gone();
}

export function notReceiving() {
  return refusal(409, 'This upload is being checked. Wait for it to end.', 'upload_not_receiving');
}

/** One queue per key; a failure ends its own run, never the queue. */
export function serialize(ctx, key, fn) {
  const previous = ctx.queues.get(key) ?? Promise.resolve();
  const run = previous.then(fn);
  const tail = run.catch(() => undefined);
  ctx.queues.set(key, tail);
  void tail.then(() => {
    if (ctx.queues.get(key) === tail) ctx.queues.delete(key);
  });
  return run;
}

export function partialRoot(ctx) {
  return path.join(uploadsRoot(ctx.rootDir), PARTIAL_DIR);
}

export function bytesPath(ctx, id) {
  return path.join(partialRoot(ctx), id);
}

function jsonPath(ctx, id) {
  return `${bytesPath(ctx, id)}.json`;
}

export async function exists(file) {
  return stat(file).then(
    () => true,
    () => false,
  );
}

export async function readSession(ctx, id) {
  if (!UPLOAD_SESSION_ID_PATTERN.test(String(id))) return null;
  try {
    return JSON.parse(await readFile(jsonPath(ctx, id), 'utf8'));
  } catch {
    return null;
  }
}

/** Temp + rename: a reader never meets half a JSON. */
export async function writeSession(ctx, session) {
  const record = { ...session, updatedAt: ctx.now().toISOString() };
  const temp = `${jsonPath(ctx, session.id)}.tmp`;
  await writeFile(temp, JSON.stringify(record));
  await rename(temp, jsonPath(ctx, session.id));
  return record;
}

/** An upload removed is its bytes AND its JSON, whatever its state. */
export async function removeSession(ctx, id) {
  await rm(bytesPath(ctx, id), { force: true });
  await rm(jsonPath(ctx, id), { force: true });
}

export async function listSessions(ctx) {
  const entries = await readdir(partialRoot(ctx)).catch(() => []);
  const sessions = [];
  for (const entry of entries.filter((name) => name.endsWith('.json'))) {
    const session = await readSession(ctx, entry.slice(0, -'.json'.length));
    if (session) sessions.push(session);
  }
  return sessions;
}

/** What the API and the screen read of an upload. */
export function publicView(session) {
  return {
    uploadId: session.id,
    filename: session.filename,
    sizeBytes: session.sizeBytes,
    receivedBytes: session.receivedBytes,
    maxChunkBytes: MAX_CHUNK_BYTES,
    state: session.state,
    code: session.code ?? null,
    ...(session.error ? { error: session.error } : {}),
    ...(session.backup ? { backup: session.backup } : {}),
  };
}
