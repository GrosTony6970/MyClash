/**
 * The hub follow's switch "notify when refereeing" (operator rulings 217, 217a): the request
 * that saves it, and the list of cards after a tap. A pure module: this package's vitest does
 * not compile TSX, so what can be tested is kept out of the component.
 */
import { apiRequest } from '@myclash/api-client';
import type { PersonFollowing } from './personContext';

/** Saved, or the status of the refusal; `null` when the request never landed. */
export type HubSwitchSave = { ok: true } | { ok: false; status: number | null };

/**
 * Saves the switch on the caller's hub follow of that person. `apiRequest` renews a login that
 * lapsed and sends once more, so a 401 here is a session that is really over.
 */
export async function saveHubSwitch(
  apiUrl: string,
  globalPersonId: string,
  on: boolean,
): Promise<HubSwitchSave> {
  const result = await apiRequest<unknown>(
    apiUrl,
    `/api/v1/me/follows/by-global-person/${globalPersonId}`,
    { method: 'PATCH', body: { notifyRefereeStart: on } },
  );
  if (result.ok) return { ok: true };
  return { ok: false, status: 'status' in result ? result.status : null };
}

/** The list with that person's hub switch set; every other card is the same object. */
export function withHubSwitch(
  list: PersonFollowing[],
  globalPersonId: string,
  on: boolean,
): PersonFollowing[] {
  return list.map((follow) =>
    follow.globalPersonId === globalPersonId
      ? { ...follow, hubFollow: { notifyRefereeStart: on } }
      : follow,
  );
}
