/**
 * The API's global route prefix — one definition, two consumers.
 *
 * `main.ts` applies this at boot, and `apps/api/scripts/emit-openapi.cjs`
 * applies it when generating openapi.json (which becomes the typed client every
 * frontend imports). Those used to be two hand-copied literals, and they drifted:
 * the emit script kept a `version` exclusion after the route moved under the
 * prefix, so the generated client advertised `/version` while the server served
 * `/api/v1/version`. Nothing failed — the drift gate compares the spec to itself,
 * not to reality.
 *
 * Import it, do not retype it.
 */

export const API_GLOBAL_PREFIX = 'api/v1';

/**
 * Routes served WITHOUT the prefix.
 *
 * Only /health belongs here: the Docker healthcheck and the deploy/rollback
 * smoke tests hit localhost:4000/health directly.
 *
 * Think hard before adding another. Traefik routes app./admin./scoring. by
 * `PathPrefix(/api/v1)`, so an excluded route answers on api.${DOMAIN} and 404s
 * on the three hosts the apps actually call — while still answering a local
 * curl, which is what let a stale `version` entry sit here unnoticed.
 */
export const API_GLOBAL_PREFIX_EXCLUDE: string[] = ['health'];
