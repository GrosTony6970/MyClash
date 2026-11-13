import { apiRequest, failureCode } from '@myclash/api-client';
import type {
  FightBookBlock,
  FightBookAskable,
  FightBookEvent,
  EventFindCard,
  FightBookSettings,
  FindCard,
  FindPage,
  IncomingSparRequest,
  MySpars,
  OpenCallsAtEvent,
  ThanksPage,
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

export type FightBookWrite<T> =
  { ok: true; data: T } | { ok: false; code: string | null; status: number | null };

async function read<T>(
  apiUrl: string,
  path: string,
  isShape: (value: unknown) => boolean,
  signal?: AbortSignal,
): Promise<FightBookRead<T>> {
  const res = await apiRequest<unknown>(apiUrl, path, { signal });
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
    '/api/v1/me/fightbook/settings',
    (v) => isObject(v) && typeof v['hasProfile'] === 'boolean' && typeof v['enabled'] === 'boolean',
    signal,
  );

export const readInbox = (apiUrl: string, signal?: AbortSignal) =>
  read<IncomingSparRequest[]>(apiUrl, '/api/v1/me/fightbook/inbox', Array.isArray, signal);

export const readMySpars = (apiUrl: string, signal?: AbortSignal) =>
  read<MySpars>(
    apiUrl,
    '/api/v1/me/fightbook/spars',
    (v) => isObject(v) && Array.isArray(v['spars']) && Array.isArray(v['sent']),
    signal,
  );

export const readBlocks = (apiUrl: string, signal?: AbortSignal) =>
  read<FightBookBlock[]>(apiUrl, '/api/v1/me/fightbook/blocks', Array.isArray, signal);

const isEventDays = (v: unknown) =>
  isObject(v) &&
  typeof v['id'] === 'string' &&
  typeof v['name'] === 'string' &&
  Array.isArray(v['days']);

const isCard = (v: unknown) => isObject(v) && isObject(v['fighter']) && Array.isArray(v['weapons']);

/** Slice 2: may I ask this fighter? Anything but `{ askable: true }` draws no button. */
export const readAskableFighter = (apiUrl: string, globalPersonId: string, signal?: AbortSignal) =>
  read<FightBookAskable>(
    apiUrl,
    `/api/v1/me/fightbook/fighters/${encodeURIComponent(globalPersonId)}/askable`,
    (v) => isObject(v) && typeof v['askable'] === 'boolean' && typeof v['favourite'] === 'boolean',
    signal,
  );

/** The Events I can name in an ask (public, I am on the roster, not over). */
export const readFightBookEvents = (apiUrl: string, signal?: AbortSignal) =>
  read<FightBookEvent[]>(
    apiUrl,
    '/api/v1/me/fightbook/events',
    (v) => Array.isArray(v) && v.every(isEventDays),
    signal,
  );

/** For these Event people, who is askable: `personId -> globalPersonId` (`{}` is normal). */
export const readAskableAtEvent = (
  apiUrl: string,
  eventId: string,
  personIds: string[],
  signal?: AbortSignal,
) => {
  const query = new URLSearchParams({ persons: personIds.join(',') });
  return read<Record<string, string>>(
    apiUrl,
    `/api/v1/me/fightbook/events/${encodeURIComponent(eventId)}/askable?${query}`,
    (v) => isObject(v) && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string'),
    signal,
  );
};

/** FightBook fighters on an Event's roster, optionally narrowed to one catalog weapon id. */
export const readFindAtEvent = (
  apiUrl: string,
  eventId: string,
  weapon: string,
  signal?: AbortSignal,
) => {
  const query = new URLSearchParams(weapon ? { weapon } : {}).toString();
  return read<EventFindCard[]>(
    apiUrl,
    `/api/v1/me/fightbook/events/${encodeURIComponent(eventId)}/find${query ? `?${query}` : ''}`,
    (v) => Array.isArray(v) && v.every(isCard),
    signal,
  );
};

/** Today's open calls at an Event: mine, and the others I may see. */
export const readOpenCalls = (apiUrl: string, eventId: string, signal?: AbortSignal) =>
  read<OpenCallsAtEvent>(
    apiUrl,
    `/api/v1/me/fightbook/events/${encodeURIComponent(eventId)}/calls`,
    (v) => isObject(v) && Array.isArray(v['mine']) && Array.isArray(v['others']),
    signal,
  );

/** One page of all of FightBook; `q` narrows by name, `weapon` is a catalog weapon id. */
export const readFindBrowse = (
  apiUrl: string,
  q: string,
  weapon: string,
  page: number,
  signal?: AbortSignal,
) => {
  // The API's strict schema refuses an empty `weapon` (a uuid), so empty filters are left out.
  const query = new URLSearchParams({
    ...(q ? { q } : {}),
    ...(weapon ? { weapon } : {}),
    page: String(page),
  });
  return read<FindPage>(
    apiUrl,
    `/api/v1/me/fightbook/find?${query}`,
    (v) =>
      isObject(v) &&
      Array.isArray(v['items']) &&
      v['items'].every(isCard) &&
      typeof v['more'] === 'boolean',
    signal,
  );
};

/** One page of the signed thank-yous I received, newest first (0-based page). */
export const readThanks = (apiUrl: string, page: number, signal?: AbortSignal) =>
  read<ThanksPage>(
    apiUrl,
    `/api/v1/me/fightbook/thanks?page=${page}`,
    (v) =>
      isObject(v) &&
      Array.isArray(v['items']) &&
      v['items'].every(
        (t) => isObject(t) && isObject(t['from']) && typeof t['stars'] === 'number',
      ) &&
      typeof v['more'] === 'boolean',
    signal,
  );

/** My favourites who can still be asked, by name (ruling 679). */
export const readFavourites = (apiUrl: string, signal?: AbortSignal) =>
  read<FindCard[]>(
    apiUrl,
    '/api/v1/me/fightbook/favourites',
    (v) => Array.isArray(v) && v.every(isCard),
    signal,
  );

/** The active weapon catalog (public): ids for the Find filter, names for an ask. */
export const readWeaponCatalog = (apiUrl: string, signal?: AbortSignal) =>
  read<Array<{ id: string; name: string }>>(
    apiUrl,
    '/api/v1/weapons?active=true',
    (v) =>
      Array.isArray(v) &&
      v.every((w) => isObject(w) && typeof w['id'] === 'string' && typeof w['name'] === 'string'),
    signal,
  );

/** One FightBook write; a refusal answers its `code` (null when the body named none). */
export async function writeFightBook<T>(
  apiUrl: string,
  path: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<FightBookWrite<T>> {
  const res = await apiRequest<T>(apiUrl, path, { method, body });
  if (res.ok) return { ok: true, data: res.data };
  return { ok: false, code: failureCode(res), status: res.kind === 'http' ? res.status : null };
}
