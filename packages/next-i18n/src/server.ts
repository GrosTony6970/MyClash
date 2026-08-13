import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, negotiateLocale, type Locale } from '@myclash/i18n/runtime';
// The server renders on the server: the composed dictionary costs nothing on the
// wire here, and `getServerT` is used from generateMetadata and server
// components that may reach any namespace.
import { createTranslator, getMessages, type TranslationValues } from '@myclash/i18n';

/**
 * Resolve the visitor's locale server-side: an explicit `mc_locale` cookie
 * wins (set by the language switcher), else the browser's Accept-Language,
 * else `defaultLocale`. Reading the request opts the caller into dynamic
 * rendering — intended, since the rendered output is locale-specific.
 *
 * ── Why the try/catch, in all three apps ────────────────────────────────────
 * Next 16 throws from cookies()/headers() when they are called outside a
 * request scope. web-public hit that in July: its perf harness
 * (apps/web-public/scripts/stats-render.perf.tsx) imports the stats page and
 * calls it as a plain async function, with no request around it, and the render
 * crashed. a53b6a0d wrapped the two reads there. The other two apps never got
 * the fix — unidirectional drift, not a deliberate per-app difference — so
 * folding the three copies together meant choosing one behaviour for all.
 *
 * This one, because the catch is unreachable under a real request (inside one,
 * cookies() does not throw), and the fallback is not a guess: `negotiateLocale`
 * is documented as never throwing and with both inputs null it returns
 * `defaultLocale` with no I/O. The alternative was a `strict` flag on a shared
 * function whose only purpose would be to preserve a crash.
 *
 * The cost, stated plainly: an off-request render in web-admin or web-staff now
 * renders in English instead of throwing. For a non-critical enhancement that
 * is the right trade, and it is the one web-public already made.
 */
export async function resolveServerLocale(): Promise<Locale> {
  try {
    const cookie = (await cookies()).get(LOCALE_COOKIE)?.value ?? null;
    const acceptLanguage = (await headers()).get('accept-language');
    return negotiateLocale({ cookie, acceptLanguage });
  } catch {
    return negotiateLocale({ cookie: null, acceptLanguage: null });
  }
}

/**
 * A request-scoped translator bound to the resolved locale. Use in server
 * components and `generateMetadata` in place of the module-level `t` (which is
 * permanently bound to `defaultLocale` and always renders English).
 */
export async function getServerT(): Promise<(key: string, values?: TranslationValues) => string> {
  return createTranslator(getMessages(await resolveServerLocale()));
}
