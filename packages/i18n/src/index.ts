import { en } from './messages/en/index.js';
import { fr } from './messages/fr/index.js';
import { createTranslator, defaultLocale } from './runtime.js';
import type { DeepString, Locale } from './message-tree.js';

/**
 * The dictionary, composed from one module per namespace under src/messages/,
 * plus the runtime re-exported from src/runtime.ts.
 *
 * It used to be one 16,000-line file. The namespaces already mapped onto the
 * three apps, but a single module meant every app shipped all of them: 181KB
 * gzip of EN+FR in every client bundle, on every page, to read as little as 4%
 * of it on the scoring pad.
 *
 * Importing from HERE pulls every namespace, which is correct on the server, in
 * this package's tests, and anywhere that walks the whole tree. Anything that
 * ships to a browser must import a surface (`@myclash/i18n/staff`, `/public`,
 * `/admin`) for the data and `@myclash/i18n/runtime` for `createTranslator`,
 * `negotiateLocale` and friends — importing them from here would drag the data
 * along behind them and undo the split.
 *
 * Adding a string: edit `messages/en/<namespace>.ts` and the matching `fr` file.
 * The FR module is typed against the EN one, so a missing key is a tsc error.
 */
export {
  createTranslator,
  defaultLocale,
  isSupportedLocale,
  LOCALE_COOKIE,
  negotiateLocale,
  SUPPORTED_LOCALES,
} from './runtime.js';
export type { DeepString, Locale, MessageTree, TranslationValues } from './runtime.js';

export { en, fr };

export const messages = {
  en,
  fr,
} as const;

export type Messages = DeepString<typeof en>;

/** Dot-path union of every leaf key in the `en` message tree (the compile-time key list). */
type LeafPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafPaths<T[K]>}`;
}[keyof T & string];

/**
 * Strict union of all known translation keys. Use it to type key-bearing values
 * (component props, config fields) so typos are caught at `tsc` —
 * e.g. `labelKey: KnownTranslationKey`.
 */
export type KnownTranslationKey = LeafPaths<typeof en>;

/**
 * Key type accepted by `t()`. Known keys get IDE autocomplete; the `(string & {})`
 * arm preserves dynamically-built keys (template literals) and runtime strings, so
 * existing dynamic call sites keep compiling. Inline-literal typos remain covered by
 * the `t-key-references.test.ts` CI guard.
 */
export type TranslationKey = KnownTranslationKey | (string & {});

export function getMessages(locale: Locale | string = defaultLocale): Messages {
  return messages[locale as Locale] ?? messages[defaultLocale];
}

export const t = createTranslator(getMessages(defaultLocale));
