import { Readable } from 'node:stream';
import { CSV_EXCEL_FR, CSV_STANDARD } from '@myclash/types';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { createStoredZip } from '../../common/stored-zip';
import { readZip } from '../../common/testing/zip-reader';
import { photoDownloadQuerySchema } from './photo-queue.dto';
import { PhotosController } from './photos.controller';

const EVENT = '6f9619ff-8b86-4011-b42d-00c04fc964ff';
const TAG = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ZIP = createStoredZip({ 'photos.csv': 'file\r\n' });

function controller(body: () => Readable = () => Readable.from([ZIP])) {
  const moderation = {
    eventForOrganiser: vi.fn(async (eventId: string) => ({ id: eventId, gate: 'organiser' })),
  };
  const downloads = {
    zip: vi.fn(async () => ({ filename: 'fal-2026-photos.zip', body: body() })),
  };
  const supabase = { getAuthUser: vi.fn(async () => ({ id: 'user-7' })) };
  const ctl = new PhotosController(
    {} as never,
    {} as never,
    {} as never,
    { get: () => 'production' } as never,
    supabase as never,
    moderation as never,
    {} as never,
    downloads as never,
  );
  return { ctl, moderation, downloads };
}

const req = (cookies: Record<string, string> = {}) => ({ cookies, headers: {} }) as never;
const signedIn = () => req({ 'sb-access-token': 'session' });
const reply = () => {
  const r = { header: vi.fn(() => r), send: vi.fn((_body: unknown) => r) };
  return r;
};
const query = { csv: 'standard' as const };

describe('GET events/:eventId/photos/download', () => {
  it('sends the zip of the Event the organiser gate gave, as an attachment never cached', async () => {
    const { ctl, moderation, downloads } = controller();
    const r = reply();
    await ctl.download(EVENT, { ...query, tournamentId: TAG }, signedIn(), r as never);

    expect(moderation.eventForOrganiser).toHaveBeenCalledWith(EVENT, 'user-7');
    expect(downloads.zip).toHaveBeenCalledWith(
      { id: EVENT, gate: 'organiser' },
      { tournamentId: TAG, workshopId: undefined },
      CSV_STANDARD,
    );
    expect(r.header).toHaveBeenCalledWith('Content-Type', 'application/zip');
    expect(r.header).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="fal-2026-photos.zip"',
    );
    expect(r.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(r.send.mock.calls[0]![0]).toBeInstanceOf(Readable);
  });

  it("writes photos.csv for French Excel when asked, for one Workshop's photos", async () => {
    const { ctl, downloads } = controller();
    await ctl.download(EVENT, { csv: 'excel-fr', workshopId: TAG }, signedIn(), reply() as never);
    expect(downloads.zip).toHaveBeenCalledWith(
      expect.anything(),
      { tournamentId: undefined, workshopId: TAG },
      CSV_EXCEL_FR,
    );
  });

  it('refuses a signed-out caller before any zip is made', async () => {
    const { ctl, downloads } = controller();
    await expect(ctl.download(EVENT, query, req(), reply() as never)).rejects.toThrow(
      'Authentication required',
    );
    expect(downloads.zip).not.toHaveBeenCalled();
  });

  it('makes no zip when the organiser gate refuses', async () => {
    const { ctl, moderation, downloads } = controller();
    moderation.eventForOrganiser.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(ctl.download(EVENT, query, signedIn(), reply() as never)).rejects.toThrow(
      'Forbidden',
    );
    expect(downloads.zip).not.toHaveBeenCalled();
  });
});

describe('PhotoDownloadQueryDto', () => {
  const parse = (q: Record<string, string>) => photoDownloadQuerySchema.safeParse(q);

  it('reads the standard csv by default, and one Tournament or one Workshop', () => {
    expect(parse({})).toEqual({ success: true, data: { csv: 'standard' } });
    expect(parse({ workshopId: TAG, csv: 'excel-fr' }).success).toBe(true);
  });

  it('refuses both filters at once, a filter that is not an id, and an unknown key', () => {
    expect(parse({ tournamentId: TAG, workshopId: TAG }).success).toBe(false);
    expect(parse({ tournamentId: 'longsword' }).success).toBe(false);
    expect(parse({ csv: 'tsv' }).success).toBe(false);
    expect(parse({ page: '2' }).success).toBe(false);
  });
});

describe('the zip on the wire (Fastify, as the API sends it)', () => {
  async function served(body: () => Readable) {
    const app = Fastify();
    const { ctl } = controller(body);
    app.get('/zip', (request, r) => ctl.download(EVENT, query, signedIn(), r));
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    return { app, url: `${address}/zip` };
  }

  it('arrives whole, with its headers, readable as a zip', async () => {
    const { app, url } = await served(() => Readable.from([ZIP]));
    try {
      const res = await fetch(url);
      expect(res.headers.get('content-type')).toBe('application/zip');
      const zip = readZip(Buffer.from(await res.arrayBuffer()));
      expect(zip.entries.map((e) => e.name)).toEqual(['photos.csv']);
    } finally {
      await app.close();
    }
  });

  it('is cut, not finished, when the bucket fails after the first byte', async () => {
    async function* failing() {
      yield ZIP.subarray(0, 10);
      throw new Error('Photo bucket answered HTTP 500 (InternalError)');
    }
    const { app, url } = await served(() => Readable.from(failing()));
    try {
      const res = await fetch(url);
      expect(res.status).toBe(200);
      await expect(res.arrayBuffer()).rejects.toThrow();
    } finally {
      await app.close();
    }
  });
});
