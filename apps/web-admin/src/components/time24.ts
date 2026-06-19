/**
 * Pure 24-hour time parsing for the workshop time fields. Native
 * `<input type="time">` renders AM/PM on locales that prefer it, so we
 * drive a custom text field with these helpers instead — always 24h.
 */

/**
 * Normalise free-typed time into canonical `HH:MM` (24h), or `null` when
 * it isn't a valid time. Accepts colon forms ("9:5", "09:00") and
 * digit-only forms ("14", "905", "0900").
 */
export function normalizeTime24(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;

  let h: number;
  let m: number;
  if (s.includes(':')) {
    const parts = s.split(':');
    if (parts.length !== 2 || !/^\d{1,2}$/.test(parts[0]!) || !/^\d{1,2}$/.test(parts[1]!)) {
      return null;
    }
    h = Number(parts[0]);
    m = Number(parts[1]);
  } else if (/^\d+$/.test(s)) {
    if (s.length <= 2) {
      h = Number(s);
      m = 0;
    } else if (s.length === 3) {
      h = Number(s.slice(0, 1));
      m = Number(s.slice(1));
    } else if (s.length === 4) {
      h = Number(s.slice(0, 2));
      m = Number(s.slice(2));
    } else {
      return null;
    }
  } else {
    return null;
  }

  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** True only for a canonical 24h `HH:MM` string. */
export function isValidTime24(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}
