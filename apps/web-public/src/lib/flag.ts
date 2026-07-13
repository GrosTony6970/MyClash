/** Regional-indicator flag emoji from an ISO 3166-1 alpha-2 country code.
 *  Returns null for missing/invalid codes so callers can skip rendering. */
export function flagEmoji(code: string | null | undefined): string | null {
  if (!code) return null;
  const cc = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return null;
  return String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}
