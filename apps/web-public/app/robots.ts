import type { MetadataRoute } from 'next';
import { getAppOrigin } from '@/lib/app-origin';
import { buildRobotsRules } from './robots-rules';

/**
 * `/robots.txt`.
 *
 * The policy itself lives in `robots-rules.ts` so it can be unit-tested; this
 * file only supplies the origin, which is the one thing a test cannot assert
 * about the deployed value.
 *
 * Rendered at RUNTIME, not prerendered. The policy itself is constant, but the
 * origin in the `Sitemap:` line comes from `PUBLIC_APP_ORIGIN`, which is set in
 * the container's `environment:` and is absent during `docker build` — a
 * prerendered robots.txt would ship pointing at `http://localhost:3001`. There
 * is no I/O here, so rendering per request costs nothing.
 */
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return buildRobotsRules(getAppOrigin());
}
