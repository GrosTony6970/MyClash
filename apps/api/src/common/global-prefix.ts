/**
 * The API's global route prefix — one definition, two consumers.
 *
 * `common/http-bootstrap.ts` applies this at boot, and `apps/api/scripts/emit-openapi.cjs`
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
 * /health: the Docker healthcheck and the deploy/rollback smoke tests hit
 * localhost:4000/health directly.
 *
 * The two `.well-known/oauth-protected-resource` paths (MCP connector discovery,
 * RFC 9728): Claude reads them at the root of the host it was given, with no
 * token. Deliberate — the host is api.${DOMAIN}, which the `myclash-api` Traefik
 * router sends whole to the API, so they answer exactly where Claude asks.
 *
 * Think hard before adding another. Traefik routes app./admin./scoring. by
 * `PathPrefix(/api/v1)`, so an excluded route answers on api.${DOMAIN} and 404s
 * on the three hosts the apps actually call — while still answering a local
 * curl, which is what let a stale `version` entry sit here unnoticed.
 */
export const API_GLOBAL_PREFIX_EXCLUDE: string[] = [
  'health',
  '.well-known/oauth-protected-resource/api/v1/mcp',
  '.well-known/oauth-protected-resource',
];
