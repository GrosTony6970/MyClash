import type { APIRequestContext, APIResponse } from '@playwright/test';

/**
 * The shared API client for the prod E2E specs.
 *
 * Extracted from `_bracket.ts` once more than the bracket spec needed it. Wraps
 * a Playwright request context with three things every spec wants:
 *
 *   - the `/api/v1` prefix, so call sites read as endpoint paths;
 *   - optional pacing, for runs from an IP that is not in the API's
 *     `THROTTLE_IP_WHITELIST` (the throttle is 120/min on EVERY request, not
 *     just writes);
 *   - `ok()`, which turns a non-2xx into an error carrying the status and body.
 *     Without it a failed setup call surfaces much later as a confusing
 *     assertion failure on missing data.
 *
 * Deliberately free of workspace-package imports: the e2e runner resolves them
 * poorly, which is why `07-populate-event.spec.ts` inlines its own date helper.
 */

type RequestOptions = Parameters<APIRequestContext['post']>[1];

/** Pace writes under the API's per-IP throttle from a non-whitelisted network. */
const PACE_MS = Number(process.env.E2E_PACE_MS ?? '0') || 0;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface Api {
  get: (path: string) => Promise<APIResponse>;
  post: (path: string, options?: RequestOptions) => Promise<APIResponse>;
  patch: (path: string, options?: RequestOptions) => Promise<APIResponse>;
  put: (path: string, options?: RequestOptions) => Promise<APIResponse>;
  delete: (path: string, options?: RequestOptions) => Promise<APIResponse>;
  /** Throws with status + body when the response isn't 2xx. */
  ok: (res: APIResponse) => Promise<APIResponse>;
  /** `ok()` then parse the body. */
  json: <T>(res: APIResponse) => Promise<T>;
}

/** Wrap a Playwright request context with the `/api/v1` prefix + pacing. */
export function apiFor(request: APIRequestContext): Api {
  let lastAt = 0;
  const paced = async <T>(fn: () => Promise<T>): Promise<T> => {
    const wait = lastAt + PACE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    return fn();
  };
  const url = (path: string) => `/api/v1/${path}`;

  const ok = async (res: APIResponse): Promise<APIResponse> => {
    if (!res.ok()) {
      throw new Error(`${res.url()} → ${res.status()}: ${(await res.text()).slice(0, 300)}`);
    }
    return res;
  };

  return {
    get: (path) => paced(() => request.get(url(path))),
    post: (path, options) => paced(() => request.post(url(path), options)),
    patch: (path, options) => paced(() => request.patch(url(path), options)),
    put: (path, options) => paced(() => request.put(url(path), options)),
    delete: (path, options) => paced(() => request.delete(url(path), options)),
    ok,
    json: async <T>(res: APIResponse): Promise<T> => (await (await ok(res)).json()) as T,
  };
}
