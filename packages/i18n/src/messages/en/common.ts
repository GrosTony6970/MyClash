import type { MessageTree } from '../../message-tree.js';

export const common = {
  cancel: 'Cancel',
  error: 'Something went wrong.',
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
  tooManyRequests: 'Too many requests. Wait a moment and retry.',
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
