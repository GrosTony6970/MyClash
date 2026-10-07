/**
 * The maintenance lockdown (operator ruling 308): a super admin's switch that lets only
 * platform staff sign in to the admin site.
 *
 * The `code` of the 503 the API answers while it is on: at the sign-in door, on the admin's own
 * routes, and on a save under the Event, Tournament, organization, club and League routes
 * (rulings 327, 327a). The API writes the value, the apps read it back into a sentence.
 */
export const ADMIN_LOCKDOWN_CODE = 'admin_lockdown';
