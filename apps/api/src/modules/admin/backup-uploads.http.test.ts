/**
 * A backup upload's chunk and the ops runner's refusals, through the real HTTP stack: the
 * multipart plugin, the Zod pipe, the exception filter (`configureHttpApp`). The ops runner is a
 * stub behind `fetch`, so what the API forwards and what the screen reads are both measured.
 */
import 'reflect-metadata';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_GLOBAL_PREFIX } from '../../common/global-prefix';
import { configureHttpApp } from '../../common/http-bootstrap';
import { BackupUploadsService } from './backup-uploads.service';
import { BackupsAdminController } from './backups.controller';
import { AdminBackupsService } from './backups.service';
import { PlatformRoleGuard } from './guards/platform-role.guard';

const MIB = 1024 * 1024;
const ID = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';

interface RunnerCall {
  url: string;
  method: string;
  contentType: string | null;
  body: Uint8Array | null;
}

/** The ops runner as `fetch` sees it: records each call, answers what the test set. */
const runner = {
  calls: [] as RunnerCall[],
  answer: { status: 200, body: {} as unknown },
};

async function stubFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const body = init?.body;
  runner.calls.push({
    url: String(input),
    method: init?.method ?? 'GET',
    contentType: new Headers(init?.headers).get('content-type'),
    body: body instanceof Uint8Array ? body : null,
  });
  return new Response(JSON.stringify(runner.answer.body), {
    status: runner.answer.status,
    headers: { 'content-type': 'application/json' },
  });
}

let app: NestFastifyApplication;
let base: string;

beforeAll(async () => {
  const uploads = new BackupUploadsService({
    opsRunnerUrl: 'http://ops-runner:4075',
    opsRunnerSecret: 'secret',
    fetchImpl: stubFetch as typeof fetch,
  });
  const moduleRef = await Test.createTestingModule({
    controllers: [BackupsAdminController],
    providers: [
      { provide: AdminBackupsService, useValue: {} },
      { provide: BackupUploadsService, useValue: uploads },
    ],
  })
    .overrideGuard(PlatformRoleGuard)
    .useValue({ canActivate: () => true })
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: false,
  });
  await configureHttpApp(app, { reportException: () => undefined });
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as { port: number };
  base = `http://127.0.0.1:${port}/${API_GLOBAL_PREFIX}/admin/backups/uploads`;
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  runner.calls = [];
  runner.answer = { status: 200, body: { receivedBytes: 0 } };
});

function chunkForm(bytes: Uint8Array<ArrayBuffer>): FormData {
  const form = new FormData();
  form.set('file', new Blob([bytes]), 'blob');
  return form;
}

async function put(offset: string, bytes: Uint8Array<ArrayBuffer>, id = ID) {
  const res = await fetch(`${base}/${id}/chunks?offset=${offset}`, {
    method: 'PUT',
    body: chunkForm(bytes),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('a backup upload chunk, over HTTP', () => {
  it('reaches the ops runner whole, raw, at its offset', async () => {
    const bytes = new Uint8Array(3 * MIB).map((_, i) => i % 251);
    runner.answer = { status: 200, body: { receivedBytes: 4 * MIB } };
    expect(await put(String(MIB), bytes)).toEqual({
      status: 200,
      body: { receivedBytes: 4 * MIB },
    });
    expect(runner.calls).toHaveLength(1);
    const [call] = runner.calls;
    expect(call?.url).toBe(`http://ops-runner:4075/upload-sessions/${ID}/chunks?offset=${MIB}`);
    expect([call?.method, call?.contentType]).toEqual(['PUT', 'application/octet-stream']);
    expect(Buffer.from(call?.body ?? []).equals(Buffer.from(bytes))).toBe(true);
  });

  it('over 16 MiB is refused 413 with the limit, and never forwarded', async () => {
    const refused = await put('0', new Uint8Array(16 * MIB + 1));
    expect(refused.status).toBe(413);
    expect(refused.body).toMatchObject({
      code: 'file_too_large',
      details: { maxBytes: 16 * MIB },
    });
    expect(runner.calls).toHaveLength(0);
  });

  it('refuses an offset that is not digits, and an id that is not an upload', async () => {
    for (const offset of ['1e3', '-1', '']) {
      expect((await put(offset, new Uint8Array(4))).status).toBe(400);
    }
    expect((await put('0', new Uint8Array(4), 'upload-1')).status).toBe(400);
    expect(runner.calls).toHaveLength(0);
  });
});

describe("the ops runner's refusals, as the screen reads them", () => {
  it('an out-of-order chunk: 409, its code, and the offset to resume from in details', async () => {
    runner.answer = {
      status: 409,
      body: { error: 'out of order', code: 'upload_out_of_order', details: { receivedBytes: 8 } },
    };
    const refused = await put('0', new Uint8Array(4));
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      code: 'upload_out_of_order',
      details: { receivedBytes: 8 },
    });
  });

  it('a file over the limit at the start: 413, file_too_large, details.maxBytes', async () => {
    runner.answer = {
      status: 413,
      body: { error: 'too large', code: 'file_too_large', details: { maxBytes: 2 * 1024 * MIB } },
    };
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filename: 'db-20261030T030000Z.sql.gz',
        sizeBytes: 3 * 1024 * MIB,
        fingerprint: 'a'.repeat(64),
      }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({
      code: 'file_too_large',
      details: { maxBytes: 2 * 1024 * MIB },
    });
  });

  it('a gone upload: 404 with its code; an uncoded 404 is the runner failing (503)', async () => {
    runner.answer = { status: 404, body: { error: 'gone', code: 'upload_gone' } };
    const gone = await fetch(`${base}/${ID}`);
    expect([gone.status, ((await gone.json()) as { code: string }).code]).toEqual([
      404,
      'upload_gone',
    ]);
    runner.answer = { status: 404, body: { error: 'not_found' } };
    expect((await fetch(`${base}/${ID}`)).status).toBe(503);
  });
});
