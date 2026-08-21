/**
 * @myclash/api-client
 *
 * Auto-generated TypeScript API client.
 * Re-generate with: pnpm gen:api-client (running API), or emit the spec
 * offline from a built API via `node apps/api/scripts/emit-openapi.cjs`.
 *
 * Usage:
 *   import { createApiClient } from '@myclash/api-client';
 *   const api = createApiClient(getApiUrl());
 *   const me = await api.get('/api/v1/me');
 */

export type { paths, components, operations } from './generated/schema';

import type { ApiFailure } from './request';
import { isAbortLike, parseBody, responseFailure } from './request';
import { failureDetail } from './failure-message';

export { apiRequest, isAbortLike, responseFailure } from './request';
export type { ApiFailure, ApiResult } from './request';
export { failureCode, failureDetail, failureMessage } from './failure-message';
export { fetchMe, ME_PATH } from './me';
export type { MeSession, MeSessionType, MeAdmin } from './me';

/** RFC 9457 problem+json body shape emitted by the API's exception filter. */
interface ProblemBody {
  detail?: string;
  message?: string;
  status?: number;
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: ProblemBody | null,
    /**
     * The same structured failure `apiRequest` returns, so a `catch` here can
     * reach `failureMessage` instead of writing its own sentence.
     *
     * Without it the two check-in desks showed "That did not save. Try again."
     * for every refusal alike, and the reason the server sent went in the bin —
     * which is how a 403 from an edge ban read as a save that just needed
     * retrying. `message` above is for a log; this is for a person.
     */
    public readonly failure: ApiFailure,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function toError(method: string, path: string, res: Response): Promise<ApiClientError> {
  const body = (await res.json().catch(() => null)) as ProblemBody | null;
  // The same builder `apiRequest` uses, so both entry points of this package
  // classify a refusal identically. Its `detail` is the one `readDetail` had its
  // own inline copy of until 2026-08-19.
  const failure = responseFailure(res.status, body);
  const detail = failureDetail(failure);
  return new ApiClientError(
    detail
      ? `${method} ${path} failed (${res.status}): ${detail}`
      : `${method} ${path} failed: ${res.status}`,
    res.status,
    body,
    failure,
  );
}

/**
 * The `ApiFailure` behind anything `createApiClient` threw.
 *
 * Its methods reject rather than return, so a caller's `catch` holds an
 * `unknown` — and every screen that wanted the reason had to re-derive it.
 * Mirrors `apiRequest`'s own catch: a fetch that never reached the server is a
 * network failure, unless the caller aborted it.
 */
export function failureFromError(err: unknown): ApiFailure {
  if (err instanceof ApiClientError) return err.failure;
  return isAbortLike(err) ? { kind: 'aborted' } : { kind: 'network' };
}

/**
 * Minimal typed fetch wrapper. Sends cookies by default (the API's session
 * model is httpOnly-cookie based) and surfaces problem+json error details.
 * For full path-level type-safety, layer openapi-fetch on the exported types.
 */
export function createApiClient(baseUrl: string, defaultHeaders?: Record<string, string>) {
  const headers = {
    'Content-Type': 'application/json',
    ...defaultHeaders,
  };

  return {
    async get<T = unknown>(path: string, init?: RequestInit): Promise<T> {
      const res = await fetch(`${baseUrl}${path}`, {
        credentials: 'include',
        ...init,
        method: 'GET',
        headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
      });
      if (!res.ok) throw await toError('GET', path, res);
      return parseBody<T>(res);
    },
    async post<T = unknown>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
      const res = await fetch(`${baseUrl}${path}`, {
        credentials: 'include',
        ...init,
        method: 'POST',
        headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw await toError('POST', path, res);
      return parseBody<T>(res);
    },
    async patch<T = unknown>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
      const res = await fetch(`${baseUrl}${path}`, {
        credentials: 'include',
        ...init,
        method: 'PATCH',
        headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw await toError('PATCH', path, res);
      return parseBody<T>(res);
    },
    async delete(path: string, init?: RequestInit): Promise<void> {
      const res = await fetch(`${baseUrl}${path}`, {
        credentials: 'include',
        ...init,
        method: 'DELETE',
        headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
      });
      if (!res.ok) throw await toError('DELETE', path, res);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
