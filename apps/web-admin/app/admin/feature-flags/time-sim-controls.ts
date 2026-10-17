/**
 * Pure helpers for the `time_simulation` panel: reading the stored payload
 * and building what the panel sends. The API stamps the anchor itself.
 */

/** Read the stored simulated "now" ISO (for the `time_simulation` flag). */
export function readSimulatedNowIso(
  raw: Record<string, unknown> | null | undefined,
): string | null {
  if (!raw) return null;
  return typeof raw['simulatedNowIso'] === 'string' ? (raw['simulatedNowIso'] as string) : null;
}

/** UTC ISO instant → a `datetime-local` value (`YYYY-MM-DDTHH:mm`, admin-local). */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` value → the `time_simulation` payload. */
export function buildTimeSimPayload(localValue: string): { simulatedNowIso: string } | undefined {
  if (!localValue) return undefined;
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return undefined;
  return { simulatedNowIso: d.toISOString() };
}
