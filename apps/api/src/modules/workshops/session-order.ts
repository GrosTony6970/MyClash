/**
 * A Workshop's sessions in start order, a session with no start last. The ONE order every reader
 * shows: the embed comes back in no order PostgREST promises, and pages show "the first session".
 */
export function inStartOrder<T>(
  sessions: readonly T[],
  startOf: (session: T) => string | null | undefined,
): T[] {
  const at = (s: T) => {
    const start = startOf(s);
    return start ? Date.parse(start) : Number.POSITIVE_INFINITY;
  };
  return [...sessions].sort((a, b) => at(a) - at(b));
}
