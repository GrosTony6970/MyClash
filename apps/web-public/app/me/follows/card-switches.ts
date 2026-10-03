/**
 * The three alert switches of a card of the "Following" tab (operator ruling 239): the request
 * that saves a tap, and the list of cards after it. A pure module, as `hub-follow-switch.ts`: this
 * package's vitest does not compile TSX, so what can be tested is kept out of the component.
 *
 * A follow is saved per Event, and the card has ONE set of switches. The set speaks for every
 * coming Event where the account follows that person: the server saves a tap on all of them in
 * one call, and shows a switch on only when it is on in every one.
 */
import { apiRequest } from '@myclash/api-client';
import type { HubSwitchSave } from './hub-follow-switch';
import type { PersonFollowing } from './personContext';

/** One of the three switches of a card. */
export type NotifyKey = 'notifyMatchStart' | 'notifyWorkshopStart' | 'notifyRefereeStart';

/**
 * Saves one switch on every coming Event follow of that person. `apiRequest` renews a login that
 * lapsed and sends once more, so a 401 here is a session that is really over.
 */
export async function saveCardSwitch(
  apiUrl: string,
  globalPersonId: string,
  key: NotifyKey,
  on: boolean,
): Promise<HubSwitchSave> {
  const result = await apiRequest<unknown>(
    apiUrl,
    `/api/v1/me/follows/by-global-person/${globalPersonId}/events`,
    { method: 'PATCH', body: { [key]: on } },
  );
  if (result.ok) return { ok: true };
  return { ok: false, status: 'status' in result ? result.status : null };
}

/** The list with that switch of that person's card set; every other card is the same object. */
export function withCardSwitch(
  list: PersonFollowing[],
  globalPersonId: string,
  key: NotifyKey,
  on: boolean,
): PersonFollowing[] {
  return list.map((follow) =>
    follow.globalPersonId === globalPersonId && follow.eventFollow
      ? { ...follow, eventFollow: { ...follow.eventFollow, [key]: on } }
      : follow,
  );
}
