/**
 * The ceiling of every multipart file the API reads: `MULTIPART_MAX_BYTES`, 1 GiB when unset.
 *
 * Read at call time. The plugin registration (`http-bootstrap.ts`) and the one upload reader
 * (`read-upload.ts`) both ask it. A route's own limit is passed per call, and a per-call limit
 * overrides the plugin's key by key, so the reader clamps to this one: it stays a real ceiling.
 */
export function multipartMaxBytes(): number {
  const raw = process.env['MULTIPART_MAX_BYTES'];
  return raw ? Number(raw) : 1024 * 1024 * 1024;
}
