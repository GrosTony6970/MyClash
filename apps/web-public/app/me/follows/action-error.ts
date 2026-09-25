import type { KnownTranslationKey } from '@myclash/i18n';

/** What a People hub action (Search or My groups) failed on. */
export type GroupsActionError = 'nameInUse' | 'create' | 'update' | 'follow' | 'signedOut';

/**
 * The toast each failure shows (rulings 118, 123). Before, only "name already used"
 * was shown: a new group or a change the server refused quietly rolled back,
 * and a refused follow just stayed un-followed, with no word why.
 */
export const GROUPS_ACTION_ERROR_KEY: Record<GroupsActionError, KnownTranslationKey> = {
  nameInUse: 'publicApp.me.groups.nameInUse',
  create: 'publicApp.me.groups.createFailed',
  update: 'publicApp.me.groups.updateFailed',
  follow: 'publicApp.me.groups.followFailed',
  signedOut: 'publicApp.me.people.sessionEnded',
};

/**
 * Which failure a refused answer is (ruling 123): a 401 is told so, never "try again", which
 * cannot help. Its words say "reload", not "signed out": the login lasts an hour and only
 * `/me` renews it, so an open tab's 401 is usually a login a reload renews on its own.
 * Otherwise the action's own failure.
 */
export function failureOf(status: number, otherwise: GroupsActionError): GroupsActionError {
  return status === 401 ? 'signedOut' : otherwise;
}

/**
 * The message a refused People hub action shows, for the tabs with their own failure messages
 * (Following, Organizers): a 401 is the session one (see `failureOf`), anything else — a dropped
 * request has no status — the action's own.
 */
export function refusalKey(
  status: number | null,
  otherwise: KnownTranslationKey,
): KnownTranslationKey {
  return status === 401 ? GROUPS_ACTION_ERROR_KEY.signedOut : otherwise;
}

/** The failure an action's `catch` caught: its own kind, or `otherwise` for a dropped request. */
export function caughtFailure(error: unknown, otherwise: GroupsActionError): GroupsActionError {
  const kind = error instanceof Error ? error.message : '';
  return Object.hasOwn(GROUPS_ACTION_ERROR_KEY, kind) ? (kind as GroupsActionError) : otherwise;
}
