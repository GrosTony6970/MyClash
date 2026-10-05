/**
 * The maintenance lockdown (operator ruling 308): a super admin's switch that keeps everybody
 * but platform staff out of the admin site.
 *
 * The `code` of the 503 the API answers while it is on, at the sign-in door and on every
 * admin route. The API writes the value, web-admin reads it back into a sentence.
 */
export const ADMIN_LOCKDOWN_CODE = 'admin_lockdown';
