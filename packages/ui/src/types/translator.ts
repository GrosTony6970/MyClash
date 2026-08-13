/**
 * The translator shape a caller hands to a UI component.
 *
 * Structural, and deliberately not imported from @myclash/i18n. packages/ui is
 * a single CJS barrel with no tree-shaking, so any value import from the
 * dictionary lands in every app that touches any UI component — that is how the
 * whole 15-namespace, two-locale dictionary (181KB gzip) ended up on every page
 * of all three apps. A type costs nothing at runtime; a `createTranslator` call
 * costs the dictionary.
 *
 * It matches what `createTranslator()` returns and what `useI18n()` hands back,
 * so callers pass theirs straight through.
 */
export type TranslatorValues = Record<string, string | number | boolean | null | undefined>;

export type Translator = (key: string, values?: TranslatorValues) => string;
