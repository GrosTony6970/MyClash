/**
 * Test-only builder of synthetic JPEGs carrying every kind of hidden data a phone can write, each
 * with its own canary string. No real photo, no personal data (CLAUDE.md hard rule 7). The base
 * image comes from sharp; the hidden data is spliced in by hand, never with sharp's own writer, so
 * the tests check our stripper rather than sharp's.
 */
import sharp from 'sharp';

/** 64×32, red top-left quadrant, the rest blue: enough to see a rotation by sampling a pixel. */
export async function baseJpeg(options: { progressive?: boolean } = {}): Promise<Buffer> {
  const width = 64;
  const height = 32;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const red = x < width / 2 && y < height / 2;
      pixels.set(red ? [255, 0, 0] : [0, 0, 255], (y * width + x) * 3);
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90, progressive: options.progressive ?? false, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

export function segment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = marker;
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

type Order = 'II' | 'MM';
interface Entry {
  tag: number;
  type: number;
  count: number;
  value: Buffer;
}

/** A TIFF IFD block at `start`, its out-of-line values after it. Returns the bytes. */
function ifd(order: Order, start: number, entries: Entry[], next = 0): Buffer {
  const u16 = (n: number) => {
    const b = Buffer.alloc(2);
    if (order === 'II') b.writeUInt16LE(n);
    else b.writeUInt16BE(n);
    return b;
  };
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    if (order === 'II') b.writeUInt32LE(n);
    else b.writeUInt32BE(n);
    return b;
  };
  let dataAt = start + 2 + entries.length * 12 + 4;
  const table: Buffer[] = [u16(entries.length)];
  const data: Buffer[] = [];
  for (const e of entries) {
    table.push(u16(e.tag), u16(e.type), u32(e.count));
    if (e.value.length <= 4) {
      table.push(Buffer.concat([e.value, Buffer.alloc(4 - e.value.length)]));
    } else {
      table.push(u32(dataAt));
      data.push(e.value);
      dataAt += e.value.length;
    }
  }
  table.push(u32(next));
  return Buffer.concat([...table, ...data]);
}

const ascii = (text: string) => Buffer.from(`${text}\0`, 'latin1');

/** An Exif APP1: Make/Model/Artist canaries, an Orientation, and a GPS IFD with a canary datum. */
export function exifApp1(
  options: { orientation?: number; order?: Order; canary?: string } = {},
): Buffer {
  const order = options.order ?? 'II';
  const canary = options.canary ?? 'CANARY-EXIF';
  const short = (n: number) => {
    const b = Buffer.alloc(2);
    if (order === 'II') b.writeUInt16LE(n);
    else b.writeUInt16BE(n);
    return b;
  };
  const long = (n: number) => {
    const b = Buffer.alloc(4);
    if (order === 'II') b.writeUInt32LE(n);
    else b.writeUInt32BE(n);
    return b;
  };
  const ifd0Entries = (gpsAt: number): Entry[] => [
    { tag: 0x010f, type: 2, count: canary.length + 6, value: ascii(`${canary}-MAKE`) },
    { tag: 0x0110, type: 2, count: canary.length + 7, value: ascii(`${canary}-MODEL`) },
    { tag: 0x0112, type: 3, count: 1, value: short(options.orientation ?? 1) },
    { tag: 0x013b, type: 2, count: canary.length + 8, value: ascii(`${canary}-ARTIST`) },
    { tag: 0x8825, type: 4, count: 1, value: long(gpsAt) },
  ];
  const sizeOfIfd0 = ifd(order, 8, ifd0Entries(0)).length;
  const gpsAt = 8 + sizeOfIfd0;
  const ifd0 = ifd(order, 8, ifd0Entries(gpsAt));
  const gps = ifd(order, gpsAt, [
    { tag: 0x0001, type: 2, count: 2, value: ascii('N') },
    { tag: 0x0012, type: 2, count: canary.length + 5, value: ascii(`${canary}-GPS`) },
  ]);
  const header = Buffer.concat([Buffer.from(order, 'latin1'), short(42), long(8)]);
  return segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), header, ifd0, gps]));
}

/** An Exif APP1 whose IFD0 offset points far past its end. */
export function brokenExifApp1(): Buffer {
  const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0xff, 0xff, 0x00, 0x00]);
  return segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]));
}

export const HIDDEN_SEGMENTS: Array<[string, Buffer]> = [
  [
    'CANARY-XMP',
    segment(
      0xe1,
      Buffer.from(
        'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><rdf:Description exif:GPSLatitude="45,46N" dc:creator="CANARY-XMP"/></x:xmpmeta>',
        'latin1',
      ),
    ),
  ],
  [
    'CANARY-EXTXMP',
    segment(
      0xe1,
      Buffer.concat([
        Buffer.from('http://ns.adobe.com/xmp/extension/\0', 'latin1'),
        Buffer.alloc(32, 0x41),
        Buffer.from([0, 0, 0, 13, 0, 0, 0, 0]),
        Buffer.from('CANARY-EXTXMP', 'latin1'),
      ]),
    ),
  ],
  [
    'CANARY-IPTC',
    segment(
      0xed,
      Buffer.concat([
        Buffer.from('Photoshop 3.0\0', 'latin1'),
        Buffer.from('8BIM', 'latin1'),
        Buffer.from([0x04, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10]),
        Buffer.from([0x1c, 0x02, 0x78, 0x00, 0x0b]),
        Buffer.from('CANARY-IPTC', 'latin1'),
      ]),
    ),
  ],
  ['CANARY-COM', segment(0xfe, Buffer.from('CANARY-COM', 'latin1'))],
  [
    'CANARY-JFXX',
    segment(0xe0, Buffer.concat([Buffer.from('JFXX\0\x10', 'latin1'), Buffer.from('CANARY-JFXX')])),
  ],
  [
    'CANARY-ICC',
    segment(
      0xe2,
      Buffer.concat([Buffer.from('ICC_PROFILE\0\x01\x01', 'latin1'), Buffer.from('CANARY-ICC')]),
    ),
  ],
  ['CANARY-MPF', segment(0xe2, Buffer.from('MPF\0CANARY-MPF', 'latin1'))],
  ['CANARY-APP11', segment(0xeb, Buffer.from('CANARY-APP11', 'latin1'))],
  ['CANARY-APP15', segment(0xef, Buffer.from('CANARY-APP15', 'latin1'))],
];

/** What phones append after the image's end: a second image, a video box, a Samsung block. */
export const TRAILERS: Array<[string, Buffer]> = [
  [
    'CANARY-SECOND',
    Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      segment(0xfe, Buffer.from('CANARY-SECOND', 'latin1')),
      Buffer.from([0xff, 0xd9]),
    ]),
  ],
  [
    'CANARY-MP4',
    Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypmp42CANARY-MP4', 'latin1')]),
  ],
  ['CANARY-SEF', Buffer.from('SEFH\xff\xd9CANARY-SEFSEFT', 'latin1')],
];

export const ALL_CANARIES = [
  'CANARY-EXIF',
  ...HIDDEN_SEGMENTS.map(([c]) => c),
  ...TRAILERS.map(([c]) => c),
];

/** The base with an Exif APP1, every hidden segment after SOI, and every trailer after EOI. */
export async function loadedJpeg(
  options: { orientation?: number; order?: Order; base?: Buffer } = {},
): Promise<Buffer> {
  const base = options.base ?? (await baseJpeg());
  return Buffer.concat([
    base.subarray(0, 2),
    exifApp1({ orientation: options.orientation, order: options.order }),
    ...HIDDEN_SEGMENTS.map(([, s]) => s),
    base.subarray(2),
    ...TRAILERS.map(([, t]) => t),
  ]);
}

export interface Marker {
  marker: number;
  /** The segment's length field; 0 for SOI and EOI; -1 marks bytes left after EOI. */
  length: number;
  at: number;
}

const inScan = (next: number) => next === 0x00 || (next >= 0xd0 && next <= 0xd7);

/** Every marker of a JPEG walked forward by length, each scan skipped to its end. Test-only. */
export function markersOf(jpeg: Buffer): Marker[] {
  const out: Marker[] = [{ marker: 0xd8, length: 0, at: 0 }];
  let at = 2;
  while (at < jpeg.length) {
    const marker = jpeg[at + 1]!;
    if (marker === 0xd9) {
      out.push({ marker, length: 0, at });
      at += 2;
      break;
    }
    const length = jpeg.readUInt16BE(at + 2);
    out.push({ marker, length, at });
    at += 2 + length;
    if (marker === 0xda) {
      while (at < jpeg.length && !(jpeg[at] === 0xff && !inScan(jpeg[at + 1]!))) at += 1;
    }
  }
  if (at < jpeg.length) out.push({ marker: -1, length: -1, at });
  return out;
}

/** The bytes from the first SOS marker to the end of the image: the coded picture. */
export function scanOf(jpeg: Buffer): Buffer {
  const markers = markersOf(jpeg);
  const sos = markers.find((m) => m.marker === 0xda)!;
  const eoi = markers.find((m) => m.marker === 0xd9)!;
  return jpeg.subarray(sos.at, eoi.at + 2);
}

/** A deterministic pseudo-random sequence (LCG), so the fuzz loop is the same on every run. */
export function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
