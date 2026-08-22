import type { MessageTree } from '../../message-tree.js';

export const common = {
  // The structured failures `apiRequest` returns, mapped to a sentence by
  // failureMessage() in each app's src/lib/api-failure.ts. Here rather than in
  // one app's namespace because `common` is the one namespace every surface
  // bundles, and all three apps hit the same API.
  //
  // There is no key for a failed HTTP response: the API answers problem+json
  // and its `detail` IS the message, so a hardcoded string would be the thing
  // that stopped a backup failure from ever saying why. `common.error` is the
  // fallback for the response that gives no reason.
  apiFailure: {
    network: 'Could not reach the server. Check your connection and try again.',
    unauthenticated: 'Your session has expired, or this is not yours to see. Sign in again.',
    // Not the API refusing you — something between this device and the server
    // did, so signing in again would not help. Says to wait, because the edge
    // bans that cause this expire on their own.
    blocked: 'The connection to the server was blocked. Wait a minute, then try again.',
    // A throttled request. The API's own words for it are
    // "ThrottlerException: Too many requests" — a class name, not a sentence,
    // and it would outrank a localized fallback on a 4xx like any other
    // `detail`. This is the one refusal whose reason says less than ours.
    tooManyRequests: 'Too many requests. Wait a moment and retry.',
  },
  cancel: 'Cancel',
  error: 'Something went wrong.',
  // Shown by both admin shells when the /me check ran out of retries. It has to
  // say "still signed in" out loud: the operator's own reflex on a broken menu
  // is to sign in again, and that is the one thing this state does NOT mean.
  identityUnverified:
    'Could not confirm your session. You are still signed in — the menu may be incomplete.',
  identityRetry: 'Try again',
  loading: 'Loading...',
  // Rendered by the shared PasswordChecklist in packages/ui, on every
  // surface where a password is chosen. Kept at the top level rather than
  // under publicApp because web-admin's signup reads them too.
  passwordRules: {
    length: 'At least 12 characters',
    uppercase: 'At least one uppercase letter',
    lowercase: 'At least one lowercase letter',
    digit: 'At least one digit',
    special: 'At least one symbol (! ? # @ …)',
  },
  refreshing: 'Refreshing...',
  none: 'None',
  optional: 'Optional',
  saving: 'Saving...',
  unknown: 'Unknown',
  // Human phase names, keyed by the round tokens formatRoundCode emits.
  // Resolved through roundTokenLabel() in @myclash/types so the TV display,
  // the scoring pad and the bracket headers all name a round the same way —
  // and so French gets round names at all (the bracket column headers were
  // hardcoded English). The short tokens stay in the match CODE, which
  // operators announce and several parsers read back.
  round: {
    final: 'Final',
    semiFinal: 'Semi Final',
    quarterFinal: 'Quarter Final',
    roundOf: 'Round of {count}',
    playIn: 'Play-in',
    bracketRound: 'Round {n}',
    swissRound: 'Swiss Round {n}',
    grandFinal: 'Grand Final',
    grandFinalReset: 'Grand Final Reset',
    losersRound: 'Losers Round {n}',
    winnersFinal: 'Winners Final',
    winnersSemiFinal: 'Winners Semi Final',
    winnersQuarterFinal: 'Winners Quarter Final',
    winnersRoundOf: 'Winners Round of {count}',
    winnersRound: 'Winners Round {n}',
    // Bracket COLUMN headers name the whole round, not one bout. Only the
    // three named rounds inflect — "Round of 16" already reads as a group.
    columnFinals: 'Finals',
    columnSemiFinals: 'Semi Finals',
    columnQuarterFinals: 'Quarter Finals',
  },
} as const satisfies MessageTree;
