/**
 * html.ts — one HTML escaper for every document MyClash builds as a string.
 *
 * The print/export builders assemble HTML by concatenation: a print window, a
 * scoresheet, a pool sheet. Every value they interpolate is typed by somebody
 * else — a fighter's name, a club, an organiser's note, a colour out of the
 * tournament config — so each one is an injection site into a document that
 * then runs in a browser window we opened ourselves.
 *
 * This escapes for BOTH contexts, text and attribute value, because a builder
 * cannot always tell you which one it is at the call site (`title="…"` next to
 * `<td>…</td>` two lines apart). Escaping quotes in text content renders
 * identically; leaving them out of an attribute does not.
 *
 * It is deliberately the only copy. Two private ones already existed — see
 * `escapeCsvCell` in ./csv for the same lesson learned on the CSV side.
 */

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape a value for interpolation into HTML text or a quoted attribute. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}
