/**
 * @myclash/api-client
 *
 * Auto-generated TypeScript API client.
 * Re-generate with: pnpm gen:api-client (requires running API)
 *
 * Usage:
 *   import { createApiClient } from '@myclash/api-client';
 *   const api = createApiClient('https://api.myclash.fr');
 *   const health = await api.get('/health');
 *
 * Generated types (after running pnpm gen:api-client):
 *   import type { paths, components } from '@myclash/api-client';
 */

// Generated schema types — populated by pnpm gen:api-client
// Stub export until first generation run
export type ApiPaths = Record<string, unknown>;
export type ApiComponents = Record<string, unknown>;

/**
 * Minimal typed fetch wrapper.
 * For full type-safety, use openapi-fetch (https://openapi-ts.dev/openapi-fetch/).
 */
export function createApiClient(baseUrl: string, defaultHeaders?: Record<string, string>) {
  const headers = {
    'Content-Type': 'application/json',
    ...defaultHeaders,
  };

  return {
    async get<T = unknown>(path: string, init?: RequestInit): Promise<T> {
      const res = await fetch(`${baseUrl}${path}`, {
        ...init,
        method: 'GET',
        headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
      });
      if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
      return res.json() as Promise<T>;
    },

    async post<T = unknown>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
      const res = await fetch(`${baseUrl}${path}`, {
        ...init,
        method: 'POST',
        headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
      return res.json() as Promise<T>;
    },

    async patch<T = unknown>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
      const res = await fetch(`${baseUrl}${path}`, {
        ...init,
        method: 'PATCH',
        headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`);
      return res.json() as Promise<T>;
    },

    async delete(path: string, init?: RequestInit): Promise<void> {
      const res = await fetch(`${baseUrl}${path}`, {
        ...init,
        method: 'DELETE',
        headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
      });
      if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
    },
  };
}
