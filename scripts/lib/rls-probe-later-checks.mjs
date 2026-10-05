/**
 * Checks 7 and up of the RLS probe (`scripts/db-rls-probe.mjs`), each in a module of its own.
 * The probe script is at the line cap: a new check is added here, not there.
 */

import { accountEmailsFailures } from './account-emails-probe.mjs';
import { pushAddressFailures } from './push-address-probe.mjs';
import { rosterHolderFailures } from './roster-holder-probe.mjs';

/** What is wrong, as sentences; none when all is right. Each check leaves no row behind. */
export async function laterCheckFailures(tx) {
  return [
    ...(await accountEmailsFailures(tx)),
    ...(await pushAddressFailures(tx)),
    ...(await rosterHolderFailures(tx)),
  ];
}
