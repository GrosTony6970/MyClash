/**
 * Two real 16 × 16 JPEGs, made with sharp, for the photo pages. The phone decodes a photo before
 * sending it when it is not camera-shaped (`apps/web-public/src/lib/photos/camera-jpeg.ts`), so a
 * header followed by zeros no longer stands in for a photo.
 *
 * - `CAMERA_JPEG`: baseline, one scan: sent byte for byte.
 * - `PROGRESSIVE_JPEG`: ten scans, the shape a website or Google Photos' cloud copy has: the phone
 *   draws it again as a baseline JPEG before sending it.
 */

export const CAMERA_JPEG = Buffer.from(
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCaAGFSf//Z',
  'base64',
);

export const PROGRESSIVE_JPEG = Buffer.from(
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wgARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAVAQEBAAAAAAAAAAAAAAAAAAAFBv/aAAwDAQACEAMQAAABmAup/8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQABBQIf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQAGPwIf/8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQABPyEf/9oADAMBAAIAAwAAABD7/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAIP/aAAgBAQABPxAf/9k=',
  'base64',
);

/** The bytes of the file part `name` in a multipart body. */
export function uploadedFile(body: Buffer, name: string): Buffer {
  const head = body.indexOf(`filename="${name}"`);
  const start = body.indexOf('\r\n\r\n', head) + 4;
  const end = body.indexOf('\r\n--', start);
  return body.subarray(start, end);
}

/** How many times the two-byte marker `FF xx` appears in the bytes. */
export function markerCount(bytes: Buffer, marker: number): number {
  let count = 0;
  for (let at = bytes.indexOf(0xff); at >= 0; at = bytes.indexOf(0xff, at + 1)) {
    if (bytes[at + 1] === marker) count += 1;
  }
  return count;
}
