/**
 * Read-only mode (operator ruling 334): a super admin's switch that refuses every save on the
 * platform, for everybody but a super admin.
 *
 * The `code` of the 503 the API answers to a save while it is on. Four readers compare the
 * literal (`failureMessage`, and the pad's `classifySyncFailure`, `refusalMessage` and
 * `classifyScanFailure`), so a change of the value is a change in each. The sign-up screens
 * import it (operator ruling 341): web-admin's `sign-in-failure.ts`, web-public's
 * `auth-requests.ts`.
 */
export const READ_ONLY_MODE_CODE = 'read_only_mode';
