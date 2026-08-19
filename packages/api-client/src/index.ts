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

import { parseBody } from './request';

export { apiRequest, isAbortLike } from './request';
export type { ApiFailure, ApiResult } from './request';

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
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function toError(method: string, path: string, res: Response): Promise<ApiClientError> {
  const body = (await res.json().catch(() => null)) as ProblemBody | null;
  const detail = body?.detail ?? body?.message;
  return new ApiClientError(
    detail
      ? `${method} ${path} failed (${res.status}): ${detail}`
      : `${method} ${path} failed: ${res.status}`,
    res.status,
    body,
  );
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
