/**
 * What a person is at an Event, as the public sees it: the API's `publicRolesOf` sends these
 * (the person page's header and the People search, operator ruling 2026-10-16). ONE wording.
 */
export type PersonRole = 'competitor' | 'referee' | 'instructor';

const ROLE_KEYS: Record<PersonRole, string> = {
  competitor: 'publicApp.following.roleCompetitor',
  referee: 'publicApp.following.roleReferee',
  instructor: 'publicApp.following.roleInstructor',
};

export function personRoleWord(role: PersonRole, t: (key: string) => string): string {
  return t(ROLE_KEYS[role]);
}
