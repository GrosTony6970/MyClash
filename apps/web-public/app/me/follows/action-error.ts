import type { KnownTranslationKey } from '@myclash/i18n';

/** What a People hub action (Search or My groups) failed on. */
export type GroupsActionError = 'nameInUse' | 'create' | 'update' | 'follow';

/**
 * The toast each failure shows (ruling 118). Before, only "name already used"
 * was shown: a new group or a change the server refused quietly rolled back,
 * and a refused follow just stayed un-followed, with no word why.
 */
export const GROUPS_ACTION_ERROR_KEY: Record<GroupsActionError, KnownTranslationKey> = {
  nameInUse: 'publicApp.me.groups.nameInUse',
  create: 'publicApp.me.groups.createFailed',
  update: 'publicApp.me.groups.updateFailed',
  follow: 'publicApp.me.groups.followFailed',
};
