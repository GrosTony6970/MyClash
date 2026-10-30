import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { handleUploadSessions, sendError, sendJson } from './upload-routes.mjs';
import { DB, fingerprintOf, partialDir, setup } from './upload-chunks.fixtures.mjs';

const CONTENT = Buffer.from('0123456789abcdef');
const MIB = 1024 * 1024;

/** The runner's dispatch for these routes, as server.mjs wires it, on a real socket. */
async function serve(sessions) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!(await handleUploadSessions(req, res, url, sessions))) {
        sendJson(res, 404, { error: 'not_found' });
      }
    } catch (error) {
      sendError(res, error);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = () => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  };
  return { base, close };
}

async function call(base, method, route, body) {
  const json = body !== undefined && !Buffer.isBuffer(body) && !(body instanceof ReadableStream);
  const res = await fetch(`${base}${route}`, {
    method,
    body: json ? JSON.stringify(body) : body,
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  });
  return { status: res.status, body: await res.json() };
}

async function opened(t) {
  const { rootDir, sessions } = await setup({ maxUploadBytes: 64 * MIB });
  const { base, close } = await serve(sessions);
  t.after(close);
  const created = await call(base, 'POST', '/upload-sessions', {
    filename: DB,
    sizeBytes: CONTENT.length,
    fingerprint: fingerprintOf(CONTENT),
  });
  assert.equal(created.status, 201);
  return { rootDir, sessions, base, id: created.body.uploadId };
}

test('an upload over HTTP: start, chunks, complete, staged', async (t) => {
  const { sessions, base, id } = await opened(t);
  const first = await call(
    base,
    'PUT',
    `/upload-sessions/${id}/chunks?offset=0`,
    CONTENT.subarray(0, 10),
  );
  assert.deepEqual(first, { status: 200, body: { receivedBytes: 10 } });
  await call(base, 'PUT', `/upload-sessions/${id}/chunks?offset=10`, CONTENT.subarray(10));
  assert.equal((await call(base, 'POST', `/upload-sessions/${id}/complete`)).status, 202);
  await sessions.idle();
  const done = await call(base, 'GET', `/upload-sessions/${id}`);
  assert.equal(done.body.state, 'staged');
  assert.equal((await call(base, 'DELETE', `/upload-sessions/${id}`)).status, 200);
});

test('a refusal carries its code and its details', async (t) => {
  const { base, id } = await opened(t);
  await call(base, 'PUT', `/upload-sessions/${id}/chunks?offset=0`, CONTENT.subarray(0, 4));
  assert.deepEqual(await call(base, 'PUT', `/upload-sessions/${id}/chunks?offset=0`, CONTENT), {
    status: 409,
    body: {
      error: 'This chunk is out of order.',
      code: 'upload_out_of_order',
      details: { receivedBytes: 4 },
    },
  });
});

test('a body with no length (chunked encoding) is refused 411', async (t) => {
  const { base, id } = await opened(t);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(CONTENT.subarray(0, 4));
      controller.close();
    },
  });
  const refused = await call(base, 'PUT', `/upload-sessions/${id}/chunks?offset=0`, stream);
  assert.deepEqual([refused.status, refused.body.code], [411, 'upload_length_required']);
});

test('a chunk over 16 MiB is refused 413, and the client reads it', async (t) => {
  const { base, id } = await opened(t);
  const big = Buffer.alloc(16 * MIB + 1);
  const refused = await call(base, 'PUT', `/upload-sessions/${id}/chunks?offset=0`, big);
  assert.deepEqual(
    [refused.status, refused.body.code, refused.body.details],
    [413, 'file_too_large', { maxBytes: 16 * MIB }],
  );
});

test('an early refusal reaches a client still sending 4 MiB, every time', async (t) => {
  const { base, id } = await opened(t);
  await call(base, 'PUT', `/upload-sessions/${id}/chunks?offset=0`, CONTENT.subarray(0, 4));
  const body = Buffer.alloc(4 * MIB);
  const statuses = new Set();
  for (let i = 0; i < 20; i += 1) {
    statuses.add((await call(base, 'PUT', `/upload-sessions/${id}/chunks?offset=0`, body)).status);
    const gone = `/upload-sessions/00000000-0000-4000-8000-000000000000/chunks?offset=0`;
    statuses.add((await call(base, 'PUT', gone, body)).status);
  }
  assert.deepEqual([...statuses].sort(), [404, 409]);
});

test('a client that goes away mid-chunk leaves the upload as it was', async (t) => {
  const { rootDir, sessions, base, id } = await opened(t);
  const { port } = new URL(base);
  await new Promise((resolve) => {
    const req = request({
      host: '127.0.0.1',
      port,
      method: 'PUT',
      path: `/upload-sessions/${id}/chunks?offset=0`,
      headers: { 'content-length': '8' },
    });
    req.on('error', () => undefined);
    req.write(CONTENT.subarray(0, 4), () =>
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 50),
    );
  });
  // The runner sees the abort, rejects the read, and its queue moves on: the same chunk lands.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await sessions.status(id)).receivedBytes, 0);
  assert.equal((await readFile(path.join(partialDir(rootDir), id))).length, 0);
  const retry = await call(
    base,
    'PUT',
    `/upload-sessions/${id}/chunks?offset=0`,
    CONTENT.subarray(0, 8),
  );
  assert.deepEqual(retry, { status: 200, body: { receivedBytes: 8 } });
});

test("a fault of the runner's own is a 500 with its message, and no code of Node's", async (t) => {
  const failing = {
    status: async () => {
      throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
    },
  };
  const { base, close } = await serve(failing);
  t.after(close);
  const id = '00000000-0000-4000-8000-000000000000';
  assert.deepEqual(await call(base, 'GET', `/upload-sessions/${id}`), {
    status: 500,
    body: { error: 'EIO: i/o error' },
  });
});

test('a route that is not an upload session is left to the caller', async (t) => {
  const { base } = await opened(t);
  assert.equal((await call(base, 'GET', '/upload-sessions')).status, 404);
  assert.equal((await call(base, 'GET', '/upload-sessions/x/elsewhere')).status, 404);
});
