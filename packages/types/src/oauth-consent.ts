/**
 * What the consent page and the API say to each other when Claude asks to connect to a person's
 * account. The API writes these shapes (`oauth-consent.service.ts`); the page in web-public reads
 * them back. The generated client has no response types for these routes, so this file is the one
 * owner of the contract.
 */

/** Where a callback goes back to: Claude on the web, or Claude Code on the person's computer. */
export type ConsentCallback = 'claude' | 'this-computer';

/** What the consent page shows for one connection request. */
export type ConsentView =
  | { kind: 'ask'; clientName: string; callback: ConsentCallback; scopes: string[] }
  | { kind: 'refused'; reason: 'not-claude'; redirectHost: string }
  | { kind: 'go'; redirectUrl: string }
  | { kind: 'expired' };

export type ConsentAction = 'approve' | 'deny';

/** The answer to an approve or a deny: where the browser goes next (always back to Claude). */
export interface ConsentAnswer {
  redirectUrl: string;
}
