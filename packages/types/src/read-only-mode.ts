/**
 * Read-only mode (operator ruling 334): a super admin's switch that refuses every save on the
 * platform, for everybody but a super admin.
 *
 * The `code` of the 503 the API answers to a save while it is on. Only the API imports it: the
 * three readers compare the literal (`failureMessage`, and the pad's `classifySyncFailure`,
 * `refusalMessage` and `classifyScanFailure`), so a change of the value is a change in each.
 */
export const READ_ONLY_MODE_CODE = 'read_only_mode';
