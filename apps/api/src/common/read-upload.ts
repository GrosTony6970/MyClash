import { HttpException, PayloadTooLargeException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { multipartMaxBytes } from './multipart-limit';

/**
 * The one reader of a multipart upload. Every route that takes a file reads it here
 * (`read-upload.guard.test.ts` refuses a hand-written `.file()` anywhere else).
 *
 * Each route passes its own limit. The read stops there: past `fileSize` busboy truncates the file
 * and `toBuffer` drops every further chunk while the rest of the body drains, so a request holds
 * about twice the limit at most (`Buffer.concat`), plus at most `PARTS` text fields of busboy's
 * 1 MiB each. Before, every route buffered up to the 1 GiB ceiling and only then checked the size.
 */

export interface UploadLimit {
  maxBytes: number;
  /** The English sentence of the 413, for logs and API callers. Screens say their own. */
  tooLarge: string;
}

export interface Upload {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

/** No file: what a route's service reads as "nothing uploaded" (an empty buffer). */
export const NO_UPLOAD: Upload = Object.freeze({
  buffer: Buffer.alloc(0),
  filename: '',
  mimetype: '',
});

/** The code of the 413 a too-large file gets; `failureMessage` says it in the reader's language. */
export const FILE_TOO_LARGE_CODE = 'file_too_large';

/** One file, and at most this many parts in all: no form of ours sends more than two. */
const PARTS = 8;

const NOT_MULTIPART = 'FST_INVALID_MULTIPART_CONTENT_TYPE';
const FILE_TOO_LARGE = 'FST_REQ_FILE_TOO_LARGE';

interface FilePart {
  type: 'file';
  fieldname: string;
  /** None on a part busboy takes for a file by its type alone (`application/octet-stream`). */
  filename?: string;
  mimetype: string;
  file: { resume: () => void };
  toBuffer: () => Promise<Buffer>;
}

interface FieldPart {
  type: 'field';
  fieldname: string;
  value: unknown;
}

interface MultipartOptions {
  limits: { fileSize: number; files: number; parts: number };
}

/** What @fastify/multipart adds to a request. */
interface MultipartRequest {
  file: (options: MultipartOptions) => Promise<FilePart | undefined>;
  parts: (options: MultipartOptions) => AsyncIterable<FilePart | FieldPart>;
}

interface MultipartError {
  code: string;
  statusCode: number;
  message: string;
}

/**
 * The file of a multipart request, read under `limit`, or `null` when the request carries no file
 * or is not multipart at all. `accept` sees the file's name and type before a byte is read, and
 * may throw to refuse it.
 */
export async function readUpload(
  request: FastifyRequest,
  limit: UploadLimit,
  accept?: (part: { filename: string; mimetype: string }) => void,
): Promise<Upload | null> {
  const fileSize = clampedLimit(limit);
  try {
    const part = await multipart(request).file(optionsFor(fileSize));
    if (!part) return null;
    const named = { filename: part.filename ?? '', mimetype: part.mimetype };
    if (accept) refuseUnread(part, () => accept(named));
    return { buffer: await part.toBuffer(), ...named };
  } catch (err) {
    if (codeOf(err) === NOT_MULTIPART) return null;
    throw refusalOf(err, limit, fileSize);
  }
}

/**
 * The `file` part of a multipart request, read under `limit`, and its text fields. A request that
 * is not multipart carries neither. Any other file part is drained: left unread, it held the
 * request open until the client gave up.
 */
export async function readUploadParts(
  request: FastifyRequest,
  limit: UploadLimit,
): Promise<{ buffer: Buffer | null; fields: Record<string, string> }> {
  const fileSize = clampedLimit(limit);
  const fields: Record<string, string> = {};
  let buffer: Buffer | null = null;
  try {
    for await (const part of multipart(request).parts(optionsFor(fileSize))) {
      if (part.type === 'field') fields[part.fieldname] = String(part.value);
      else if (part.fieldname === 'file') buffer = await part.toBuffer();
      else part.file.resume();
    }
  } catch (err) {
    if (codeOf(err) === NOT_MULTIPART) return { buffer: null, fields: {} };
    throw refusalOf(err, limit, fileSize);
  }
  return { buffer, fields };
}

function multipart(request: FastifyRequest): MultipartRequest {
  return request as unknown as MultipartRequest;
}

function clampedLimit(limit: UploadLimit): number {
  return Math.min(limit.maxBytes, multipartMaxBytes());
}

function optionsFor(fileSize: number): MultipartOptions {
  return { limits: { fileSize, files: 1, parts: PARTS } };
}

/** Runs `accept`; a refused file is drained first, or the request stays open. */
function refuseUnread(part: FilePart, accept: () => void): void {
  try {
    accept();
  } catch (refusal) {
    part.file.resume();
    throw refusal;
  }
}

function codeOf(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * A too-large file is the route's own 413. Any other client fault the plugin names (`FST_` and a
 * 4xx: too many parts or files, a body cut short) keeps its status and its words, built from those
 * two fields only: the filter echoes every other key of the body to the caller. Anything else is
 * a fault of ours, thrown as it is.
 */
function refusalOf(err: unknown, limit: UploadLimit, fileSize: number): unknown {
  const code = codeOf(err);
  if (code === FILE_TOO_LARGE) {
    return new PayloadTooLargeException({
      message: limit.tooLarge,
      code: FILE_TOO_LARGE_CODE,
      maxBytes: fileSize,
    });
  }
  const { statusCode, message } = err as MultipartError;
  if (code?.startsWith('FST_') && statusCode >= 400 && statusCode < 500) {
    return new HttpException({ message, code }, statusCode);
  }
  return err;
}
