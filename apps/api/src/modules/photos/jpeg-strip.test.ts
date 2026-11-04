import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_PIXELS, PhotoRefusalError, sniffPhoto, stripJpeg } from './jpeg-strip';
import {
  ALL_CANARIES,
  baseJpeg,
  brokenExifApp1,
  exifApp1,
  lcg,
  loadedJpeg,
  markersOf,
  scanOf,
  segment,
} from './testing/synthetic-jpeg';

let base: Buffer;
let loaded: Buffer;

beforeAll(async () => {
  base = await baseJpeg();
  loaded = await loadedJpeg({ orientation: 6 });
});

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err instanceof PhotoRefusalError ? err.code : `not a refusal: ${String(err)}`;
  }
};

/** The base with its SOF0 patched: `edit(sof, at)` changes bytes in place. */
const patchedSof = (edit: (jpeg: Buffer, at: number) => void): Buffer => {
  const copy = Buffer.from(base);
  const sof = markersOf(copy).find((m) => m.marker === 0xc0)!;
  edit(copy, sof.at);
  return copy;
};

describe('stripJpeg — what goes', () => {
  it.each(ALL_CANARIES)('drops %s', (canary) => {
    expect(loaded.includes(canary)).toBe(true);
    expect(stripJpeg(loaded).bytes.includes(canary)).toBe(false);
  });

  it('keeps only the picture: SOI, one 34-byte Orientation APP1, tables, SOF0, SOS, EOI, nothing after', () => {
    const kinds = markersOf(stripJpeg(loaded).bytes).map((m) => m.marker);
    expect(kinds[0]).toBe(0xd8);
    expect(kinds[1]).toBe(0xe1);
    expect(markersOf(stripJpeg(loaded).bytes)[1]!.length).toBe(34);
    expect(kinds.at(-1)).toBe(0xd9);
    expect(kinds).not.toContain(-1);
    const allowed = new Set([0xd8, 0xe1, 0xdb, 0xc4, 0xdd, 0xc0, 0xda, 0xd9]);
    expect(kinds.filter((k) => !allowed.has(k))).toEqual([]);
    expect(kinds.filter((k) => k === 0xe1)).toHaveLength(1);
  });

  it('writes no APP1 when the photo is already upright', async () => {
    const upright = await loadedJpeg({ orientation: 1 });
    expect(markersOf(stripJpeg(upright).bytes).map((m) => m.marker)).not.toContain(0xe1);
  });
});

describe('stripJpeg — what stays', () => {
  it('keeps the coded picture byte for byte', () => {
    expect(scanOf(stripJpeg(loaded).bytes).equals(scanOf(base))).toBe(true);
  });

  it('decodes to the same pixels as the image it came from', async () => {
    const upright = stripJpeg(await loadedJpeg({ orientation: 1 })).bytes;
    const [a, b] = await Promise.all([
      sharp(upright).raw().toBuffer(),
      sharp(base).raw().toBuffer(),
    ]);
    expect(a.equals(b)).toBe(true);
  });

  it('gives the same bytes when stripped twice', () => {
    const once = stripJpeg(loaded).bytes;
    expect(stripJpeg(once).bytes.equals(once)).toBe(true);
  });

  it('reports the size it read from the frame header', () => {
    expect(stripJpeg(loaded)).toMatchObject({ width: 64, height: 32 });
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8].flatMap((o) => [[o, 'II'] as const, [o, 'MM'] as const]))(
    'keeps orientation %i written in %s order',
    async (orientation, order) => {
      const out = stripJpeg(await loadedJpeg({ orientation, order }));
      expect(out.orientation).toBe(orientation);
      expect((await sharp(out.bytes).metadata()).orientation ?? 1).toBe(orientation);
    },
  );

  it('reads a broken Exif block as upright instead of failing', () => {
    const jpeg = Buffer.concat([base.subarray(0, 2), brokenExifApp1(), base.subarray(2)]);
    expect(stripJpeg(jpeg).orientation).toBe(1);
  });

  it('reads the first Exif block only', () => {
    const jpeg = Buffer.concat([
      base.subarray(0, 2),
      exifApp1({ orientation: 3 }),
      exifApp1({ orientation: 8 }),
      base.subarray(2),
    ]);
    expect(stripJpeg(jpeg).orientation).toBe(3);
  });
});

describe('sniffPhoto', () => {
  it('names a JPEG, a WebP and a HEIC by their first bytes', () => {
    expect(sniffPhoto(base)).toBe('jpeg');
    expect(sniffPhoto(Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'latin1'))).toBe('webp');
    expect(sniffPhoto(Buffer.from('\x00\x00\x00\x18ftypheic', 'latin1'))).toBe('heic');
    expect(sniffPhoto(Buffer.from('\x00\x00\x00\x18ftypmif1', 'latin1'))).toBe('heic');
    expect(sniffPhoto(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'))).toBe('unknown');
    expect(sniffPhoto(Buffer.alloc(0))).toBe('unknown');
  });
});

describe('stripJpeg — refusals', () => {
  it.each([
    ['a PNG', Buffer.from('\x89PNG\r\n\x1a\n0000', 'latin1'), 'photo_not_jpeg'],
    ['a WebP', Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'latin1'), 'photo_not_jpeg'],
    ['a HEIC', Buffer.from('\x00\x00\x00\x18ftypheic', 'latin1'), 'photo_heic'],
    ['nothing', Buffer.alloc(0), 'photo_not_jpeg'],
  ])('refuses %s', (_name, bytes, code) => {
    expect(codeOf(() => stripJpeg(bytes))).toBe(code);
  });

  it('refuses a progressive JPEG, whose decode memory its file size does not bound', async () => {
    const progressive = await baseJpeg({ progressive: true });
    expect(codeOf(() => stripJpeg(progressive))).toBe('photo_unsupported_jpeg');
  });

  it.each([
    ['lossless (SOF3)', (b: Buffer, at: number) => void (b[at + 1] = 0xc3)],
    ['arithmetic (SOF9)', (b: Buffer, at: number) => void (b[at + 1] = 0xc9)],
    ['12-bit', (b: Buffer, at: number) => void (b[at + 4] = 12)],
    ['4-component', (b: Buffer, at: number) => void (b[at + 9] = 4)],
  ])('refuses a %s frame', (_name, edit) => {
    expect(codeOf(() => stripJpeg(patchedSof(edit)))).toBe('photo_unsupported_jpeg');
  });

  it('refuses a frame declaring more pixels than any phone camera makes, before decoding', () => {
    const huge = patchedSof((b, at) => {
      b.writeUInt16BE(10_000, at + 5);
      b.writeUInt16BE(10_000, at + 7);
    });
    expect(10_000 * 10_000).toBeGreaterThan(MAX_PIXELS);
    expect(codeOf(() => stripJpeg(huge))).toBe('photo_too_many_pixels');
  });

  it.each([
    ['no end of image', () => base.subarray(0, base.length - 2)],
    [
      'a segment running past the end',
      () => Buffer.concat([base.subarray(0, 2), Buffer.from([0xff, 0xe1, 0xff, 0xff, 1, 2, 3])]),
    ],
    [
      'no scan',
      () =>
        Buffer.concat([
          base.subarray(0, 2),
          segment(0xfe, Buffer.from('x')),
          Buffer.from([0xff, 0xd9]),
        ]),
    ],
    ['a zero-size frame', () => patchedSof((b, at) => b.writeUInt16BE(0, at + 5))],
    [
      'a malformed table',
      () =>
        Buffer.concat([
          base.subarray(0, 2),
          segment(0xdb, Buffer.from('CANARY-DQT')),
          base.subarray(2),
        ]),
    ],
  ])('refuses %s as corrupt', (_name, make) => {
    expect(codeOf(() => stripJpeg(make()))).toBe('photo_corrupt');
  });
});

describe('stripJpeg — one full scan only', () => {
  /** The base's SOS header (marker included) and everything after it, up to EOI. */
  const parts = () => {
    const sos = markersOf(base).find((m) => m.marker === 0xda)!;
    const eoi = markersOf(base).find((m) => m.marker === 0xd9)!;
    return {
      head: base.subarray(0, sos.at),
      header: base.subarray(sos.at, sos.at + 2 + sos.length),
      data: base.subarray(sos.at + 2 + sos.length, eoi.at),
      eoi: base.subarray(eoi.at),
    };
  };

  // A baseline picture sent as partial scans makes libjpeg keep every coefficient of the image:
  // measured 2026-11-04, a 0.75 MB file declaring 8000×8000 took about 400 MB in sharp.
  it('refuses a scan that carries fewer components than the frame', () => {
    const { head, data, eoi } = parts();
    const oneComponent = segment(0xda, Buffer.from([1, 1, 0x00, 0, 63, 0]));
    expect(codeOf(() => stripJpeg(Buffer.concat([head, oneComponent, data, eoi])))).toBe(
      'photo_unsupported_jpeg',
    );
  });

  it('refuses a second scan', () => {
    const { head, header, data, eoi } = parts();
    expect(codeOf(() => stripJpeg(Buffer.concat([head, header, data, header, data, eoi])))).toBe(
      'photo_unsupported_jpeg',
    );
  });

  it.each([
    ['a spectral start other than 0', -3, 1],
    ['a spectral end other than 63', -2, 0],
    ['an approximation other than 0', -1, 0x10],
    ['a component the frame does not have', 5, 9],
  ])('refuses a scan with %s', (_name, offset, value) => {
    const { head, header, data, eoi } = parts();
    const patched = Buffer.from(header);
    patched[offset < 0 ? patched.length + offset : offset] = value;
    expect(codeOf(() => stripJpeg(Buffer.concat([head, patched, data, eoi])))).toBe(
      'photo_unsupported_jpeg',
    );
  });
});

describe('stripJpeg — fuzz', () => {
  it('turns 2,000 damaged photos into either clean bytes or a refusal, never anything else', () => {
    const random = lcg(20261104);
    for (let round = 0; round < 2000; round += 1) {
      const damaged = Buffer.from(loaded);
      if (random() < 0.2) {
        const cut = Math.floor(random() * damaged.length);
        const result = attempt(damaged.subarray(0, cut));
        expect(result, `round ${round}, cut ${cut}`).toBe('ok');
        continue;
      }
      const flips = 1 + Math.floor(random() * 8);
      for (let i = 0; i < flips; i += 1) {
        damaged[Math.floor(random() * damaged.length)] = Math.floor(random() * 256);
      }
      expect(attempt(damaged), `round ${round}`).toBe('ok');
    }
  }, 20_000);
});

function attempt(bytes: Buffer): string {
  try {
    const out = stripJpeg(bytes).bytes;
    const leaked = ALL_CANARIES.filter((c) => out.includes(c));
    return leaked.length === 0 ? 'ok' : `leaked ${leaked.join(', ')}`;
  } catch (err) {
    return err instanceof PhotoRefusalError ? 'ok' : `threw ${String(err)}`;
  }
}
