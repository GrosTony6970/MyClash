/**
 * The most values one PostgREST `.in()` filter carries.
 *
 * PostgREST reads `.in()` values from the URL, so a request that names every id
 * of a large batch can outgrow the request line. 200 uuids is about 8 KB once
 * encoded, the size the chunked reads in this API already use.
 */
export const IN_LIST_MAX = 200;

/**
 * `values` cut into pieces of at most `IN_LIST_MAX`, in order. No values, no
 * pieces — so a caller that reads once per piece reads nothing.
 */
export function inListChunks<T>(values: readonly T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += IN_LIST_MAX) {
    chunks.push(values.slice(i, i + IN_LIST_MAX));
  }
  return chunks;
}
