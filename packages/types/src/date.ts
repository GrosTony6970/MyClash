/**
 * Locale-aware date helpers for the DOB input/display surfaces.
 *
 * DB column + REST contract stay ISO YYYY-MM-DD (the universal
 * interchange format every downstream piece — autolink Tier 2
 * matching, comparisons, sorting — already assumes). These helpers
 * convert at the UI boundary so users read/write dates in their
 * MyClash i18n locale: FR → DD/MM/YYYY, EN → MM/DD/YYYY.
 */

/**
 * Mirror of `Locale` from `@myclash/i18n`. Inlined here to avoid a
 * cross-package dependency just for a 2-element union. Keep in sync
 * with packages/i18n/src/index.ts when locales are added.
 */
export type DateLocale = 'en' | 'fr';

export interface DateFormatSpec {
  /** Placeholder shown in inputs, e.g. 'DD/MM/YYYY'. */
  readonly placeholder: string;
  /** HTML pattern attribute matching the placeholder. */
  readonly htmlPattern: string;
  /** Parse a locale-formatted string into ISO YYYY-MM-DD, or null. */
  parse(input: string): string | null;
  /** Format an ISO YYYY-MM-DD as the locale-formatted string. */
  format(iso: string): string;
}

/**
 * Reject impossible dates (31/02, 30/02) by round-tripping through
 * Date. Returns the ISO string when it survives the round-trip,
 * null otherwise.
 */
function roundTripIso(iso: string): string | null {
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10) === iso ? iso : null;
}

const LOCALE_DATE_FORMATS: Record<DateLocale, DateFormatSpec> = {
  fr: {
    placeholder: 'JJ/MM/AAAA',
    htmlPattern: '\\d{2}/\\d{2}/\\d{4}',
    parse(input) {
      const m = input.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!m) return null;
      const [, day, month, year] = m;
      return roundTripIso(`${year}-${month}-${day}`);
    },
    format(iso) {
      const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
    },
  },
  en: {
    placeholder: 'MM/DD/YYYY',
    htmlPattern: '\\d{2}/\\d{2}/\\d{4}',
    parse(input) {
      const m = input.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!m) return null;
      const [, month, day, year] = m;
      return roundTripIso(`${year}-${month}-${day}`);
    },
    format(iso) {
      const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
    },
  },
};

export function getDateFormat(locale: DateLocale): DateFormatSpec {
  return LOCALE_DATE_FORMATS[locale];
}

/**
 * Parse a locale-formatted date string into ISO YYYY-MM-DD, or null
 * on empty/malformed input. Strict to the locale's format — passing
 * the wrong format under the wrong locale returns null.
 */
export function parseLocalizedDate(
  input: string | null | undefined,
  locale: DateLocale,
): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  return LOCALE_DATE_FORMATS[locale].parse(trimmed);
}

/** Format an ISO YYYY-MM-DD as the locale string for display. */
export function formatLocalizedDate(iso: string | null | undefined, locale: DateLocale): string {
  if (!iso) return '';
  return LOCALE_DATE_FORMATS[locale].format(iso);
}
