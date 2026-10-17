// --- Locale-aware display helpers ---------------------------------------
// The UI locale is the two-letter app locale ('en' | 'fr'); date formatting
// needs a BCP-47 tag. Inlined here (not imported from @myclash/i18n) to keep
// this package dependency-light — it is shared by the api too.
//
// Its own entry point, `@myclash/time/locale`, because the package root loads
// Luxon: a client that only needs the tag (the simulated-time badge in
// web-public's root layout) would otherwise put ~15 KB gzip on every page.

/** The two-letter UI locale. Mirror of `Locale` in @myclash/i18n. */
export type AppLocale = 'en' | 'fr';

/**
 * Map a UI locale to the BCP-47 tag used for date/number formatting. English
 * uses `en-GB` (DD/MM, 24h) rather than `en-US` — MyClash is a European HEMA
 * platform, so day-first + 24-hour reads correctly for both audiences.
 */
export function localeToBcp47(locale: AppLocale): string {
  return locale === 'fr' ? 'fr-FR' : 'en-GB';
}
