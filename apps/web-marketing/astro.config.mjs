// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

/**
 * Static marketing site at the apex domain.
 *
 * Everything here is prerendered to plain HTML and handed to Caddy — there is
 * no server at runtime, which is what keeps `web-marketing` out of the
 * `depends_on: api` requirement in scripts/check-infra-review.mjs.
 */
export default defineConfig({
  site: 'https://myclash.fr',
  output: 'static',

  /**
   * `never` matches how the site is actually addressed. The canonical links and
   * the sitemap say `https://myclash.fr/terms`, and — more to the point —
   * `LEGAL_POLICIES[kind].path` in packages/types/src/legal.ts publishes
   * `/terms` and `/privacypolicy` without a trailing slash. Those are the URLs
   * the in-app consent links and LegalUpdateBanner are built from, so the built
   * output has to answer on exactly them.
   */
  trailingSlash: 'never',
  build: { format: 'directory' },

  integrations: [
    sitemap({
      // The old sitemap.xml was hand-maintained and its lastmod had been stale
      // for three months while the legal pages were revised underneath it.
      i18n: {
        defaultLocale: 'fr',
        locales: { fr: 'fr-FR', en: 'en-GB' },
      },
    }),
  ],

  image: {
    // Sharp is already an allowed build script in pnpm-workspace.yaml (Next's
    // image pipeline needs it), so nothing new had to be approved for this.
    responsiveStyles: true,
  },

  devToolbar: { enabled: false },
});
