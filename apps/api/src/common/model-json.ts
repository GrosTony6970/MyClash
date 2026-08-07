/**
 * Tolerant JSON extraction from an LLM response.
 *
 * ## Why this exists
 *
 * Models wrap JSON in a markdown code fence even when the system prompt says
 * "return strict JSON only" — it is the single most common deviation there is.
 * Both AI JSON call sites used a bare `JSON.parse(text)`, so a fenced reply
 * failed with:
 *
 *     Unexpected token '`', "```json\n{\n"... is not valid JSON
 *
 * For the organizer setup assistant that meant EVERY draft landed `failed` with
 * an empty `proposedActions` — the whole draft→review→apply feature produced
 * nothing an organizer could ever apply. For the super-admin data-quality scan
 * it silently degraded every finding to "AI summary unavailable."
 *
 * Prompting harder is not a fix; it lowers the rate and cannot remove it. Parse
 * defensively instead, in one place, and let both call sites share it.
 *
 * Strategies, in order — the first that yields valid JSON wins:
 *   1. the text as-is (the well-behaved case);
 *   2. the contents of the first ```/```json fence;
 *   3. the widest {...} or [...] span, for replies with prose either side.
 */
export type ParsedModelJson<T> = { ok: true; value: T } | { ok: false; error: string };

const FENCE = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/;

export function parseModelJson<T>(text: string): ParsedModelJson<T> {
  const raw = (text ?? '').trim();
  if (!raw) return { ok: false, error: 'Model returned an empty response' };

  for (const candidate of candidates(raw)) {
    try {
      return { ok: true, value: JSON.parse(candidate) as T };
    } catch {
      // Try the next strategy; the error from the LAST one is reported below.
    }
  }

  // Report the failure against the ORIGINAL text, so the message names what the
  // model actually sent rather than some intermediate slice of it.
  try {
    JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid JSON' };
  }
  /* c8 ignore next */
  return { ok: false, error: 'Invalid JSON' };
}

function* candidates(raw: string): Generator<string> {
  yield raw;

  const fenced = FENCE.exec(raw)?.[1]?.trim();
  if (fenced) yield fenced;

  // Widest span between the first opening and last matching closing bracket.
  // Deliberately not a brace counter: a JSON string containing a `}` would
  // break naive counting, and JSON.parse is the real validator here anyway.
  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
  ] as const) {
    const start = raw.indexOf(open);
    const end = raw.lastIndexOf(close);
    if (start !== -1 && end > start) yield raw.slice(start, end + 1);
  }
}
