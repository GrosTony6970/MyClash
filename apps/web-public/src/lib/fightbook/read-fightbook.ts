import { apiRequest, failureCode } from '@myclash/api-client';
import type {
  FightBookBlock,
  FightBookSettings,
  IncomingSparRequest,
  MySpars,
} from '@myclash/types';

/**
 * FightBook's reads and writes, for the page at /me/fightbook (slice 1). No React here: the hook
 * (`app/me/fightbook/use-fightbook.ts`) is glue.
 *
 * A 401 is a login the API client could not renew: sign in again. Any other failure, and a body
 * that is not the shape (the browser suite's catch-all answers `{}`, a proxy may answer anything),
 * is a failed read the page says and offers to retry.
 */
export type FightBookRead<T> =
  { kind: 'data'; data: T } | { kind: 'signin' } | { kind: 'failed' } | { kind: 'aborted' };

export type FightBookWrite<T> = { ok: true; data: T } | { ok: false; code: string | null };

const BASE = '/api/v1/me/fightbook';

async function read<T>(
  apiUrl: string,
  path: string,
  isShape: (value: unknown) => boolean,
  signal?: AbortSignal,
): Promise<FightBookRead<T>> {
  const res = await apiRequest<unknown>(apiUrl, `${BASE}${path}`, { signal });
  if (res.ok) return isShape(res.data) ? { kind: 'data', data: res.data as T } : { kind: 'failed' };
  if (res.kind === 'aborted') return { kind: 'aborted' };
  if (res.kind === 'unauthenticated' && res.status === 401) return { kind: 'signin' };
  return { kind: 'failed' };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const readFightBookSettings = (apiUrl: string, signal?: AbortSignal) =>
  read<FightBookSettings>(
    apiUrl,
    '/settings',
    (v) => isObject(v) && typeof v['hasProfile'] === 'boolean' && typeof v['enabled'] === 'boolean',
    signal,
  );

export const readInbox = (apiUrl: string, signal?: AbortSignal) =>
  read<IncomingSparRequest[]>(apiUrl, '/inbox', Array.isArray, signal);

export const readMySpars = (apiUrl: string, signal?: AbortSignal) =>
  read<MySpars>(
    apiUrl,
    '/spars',
    (v) => isObject(v) && Array.isArray(v['spars']) && Array.isArray(v['sent']),
    signal,
  );

export const readBlocks = (apiUrl: string, signal?: AbortSignal) =>
  read<FightBookBlock[]>(apiUrl, '/blocks', Array.isArray, signal);

/** One FightBook write; a refusal answers its `code` (null when the body named none). */
export async function writeFightBook<T>(
  apiUrl: string,
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<FightBookWrite<T>> {
  const res = await apiRequest<T>(apiUrl, path, { method, body });
  return res.ok ? { ok: true, data: res.data } : { ok: false, code: failureCode(res) };
}

export const fightBookPath = (path: string) => `${BASE}${path}`;
