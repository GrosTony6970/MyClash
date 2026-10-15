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
    // The archived-Event lock's refusal, by its code `event_archived`: nearly
    // every screen of an archived Event can receive it (ruling 234).
    eventArchived: 'This event is archived and read-only.',
    eventCompleted:
      'This event is completed. Re-open it before you regenerate or delete what was planned.',
    // The maintenance lockdown's refusal, by its code `admin_lockdown`: one
    // global check answers it on nearly every admin screen (ruling 326). It names
    // no audience: a Fighter whose save under an Event is refused reads it too
    // (ruling 348).
    adminLockdown: 'MyClash is in maintenance. Try again later.',
    // Read-only mode's refusal, by its code `read_only_mode`: one global check
    // answers it to nearly every save, on any screen (ruling 334).
    readOnlyMode: 'MyClash is in maintenance. Nothing can be saved for now. Try again later.',
  },
  cancel: 'Cancel',
  error: 'Something went wrong.',
  // Shown by both admin shells when the /me check ran out of retries. It has to
  // say "still signed in" out loud: the operator's own reflex on a broken menu
  // is to sign in again, and that is the one thing this state does NOT mean.
  identityUnverified:
    'Could not confirm your session. You are still signed in — the menu may be incomplete.',
  identityRetry: 'Try again',
  // The whole screen of a landing page that could not read /me (ruling 295a).
  // It never says "signed in" or "signed out": the page does not know which.
  identityUnchecked: 'We could not check who is signed in. Try again in a moment.',
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
  bulkActions: 'Bulk actions',
  country: {
    clear: 'Clear country',
    noMatch: 'No country matches',
  },
  // A person whose name is blank, worded by `nameOrUnknown` (packages/ui). Never
  // their id: an organiser reads the cell aloud at the table.
  unknownName: {
    fighter: 'Unknown fighter',
    fighterWithBib: 'Unknown fighter (bib {bib})',
    referee: 'Unknown referee',
    person: 'Unknown person',
  },
  // The question of `useLeaveGuard` (packages/ui): a page with unsaved edits asks
  // before a link, a tab switch or its own Cancel leaves it.
  leaveGuard: {
    title: 'Leave without saving?',
    body: 'Your changes are not saved yet. They will be lost.',
    leave: 'Leave',
    stay: 'Stay',
  },
  // The two files a CSV download offers (operator, 2026-10-15): French Excel splits on ";" and
  // reads "12,50" as a number; English Excel and the other apps want "," and "12.50".
  csvExport: {
    excelFrench: 'Excel (French)',
    excelFrenchHint: 'Columns split by ; · decimals as 12,50',
    standard: 'Excel (English), other apps',
    standardHint: 'Columns split by , · decimals as 12.50',
  },
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
    // A bout made by hand holds no round: it is named by its phase.
    phasePool: 'Pools',
    phaseSwiss: 'Swiss',
    phaseBracket: 'Bracket',
  },
  // One word per state, per domain, on every screen (quick win X1): asked through
  // `statusLabelKey` / `statusLabel` of packages/ui, never built from the raw value.
  status: {
    match: {
      scheduled: 'Scheduled',
      running: 'Running',
      paused: 'Paused',
      completed: 'Completed',
      voided: 'Voided',
    },
    clock: {
      idle: 'Not started',
      running: 'Running',
      halted: 'Paused',
      ended: 'Ended',
    },
    event: {
      draft: 'Draft',
      published: 'Published',
      running: 'Running',
      completed: 'Completed',
      archived: 'Archived',
    },
    tournament: {
      draft: 'Draft',
      published: 'Published',
      running: 'Running',
      completed: 'Completed',
      archived: 'Archived',
    },
    registration: {
      registered: 'Registered',
      checked_in: 'Checked in',
      withdrawn: 'Withdrawn',
      disqualified: 'Disqualified',
      waitlist: 'Waiting list',
    },
    claim: {
      unclaimed: 'Unclaimed',
      guest_active: 'Guest active',
      claimed: 'Claimed',
    },
    orgRole: {
      owner: 'Owner',
      admin: 'Admin',
      editor: 'Editor',
      scorekeeper: 'Scorekeeper',
      referee: 'Referee',
      workshop_lead: 'Instructor',
      read_only: 'Read only',
    },
    staffRole: {
      scoring: 'Scoring',
      checkin: 'Check-in',
      gear: 'Gear check',
    },
    swissRound: {
      pending: 'Not started',
      running: 'Running',
      completed: 'Completed',
    },
    poolState: {
      in_progress: 'In progress',
      completed: 'Completed',
    },
    aiDraft: {
      draft: 'Draft',
      ready: 'Ready',
      failed: 'Failed',
      applied: 'Applied',
      rejected: 'Rejected',
    },
    scan: {
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed',
    },
    leagueUserRole: {
      owner: 'Owner',
      admin: 'Admin',
    },
    leagueOrgRole: {
      owner: 'Owner',
      admin: 'Admin',
      member: 'Member',
    },
    leagueAttachment: {
      requested: 'Pending',
      approved: 'Approved',
      rejected: 'Rejected',
      removed: 'Removed',
    },
    personRole: {
      competitor: 'Fighter',
      referee: 'Referee',
      workshop_lead: 'Instructor',
    },
    refereeAssignment: {
      assigned: 'Assigned',
      pending: 'Pending',
      confirmed: 'Confirmed',
    },
    color: {
      red: 'Red',
      blue: 'Blue',
      green: 'Green',
      yellow: 'Yellow',
      purple: 'Purple',
      orange: 'Orange',
      black: 'Black',
      white: 'White',
      amber: 'Amber',
      violet: 'Violet',
      teal: 'Teal',
      gold: 'Gold',
      silver: 'Silver',
      bronze: 'Bronze',
      slate: 'Slate',
      grey: 'Grey',
      brown: 'Brown',
      pink: 'Pink',
    },
  },
  // A standings column's title, per stat (`standingsColumnLabel` of packages/ui, O20).
  standings: {
    score: 'Score',
    W: 'Wins',
    L: 'Losses',
    D: 'Draws',
    F: 'Forfeits',
    ptsScored: 'Points scored',
    ptsConceded: 'Points conceded',
    diff: 'Differential',
    doubles: 'Doubles',
    hitsGiven: 'Hits given',
    hitsReceived: 'Hits received',
    swissPts: 'Swiss points',
    buchholz: 'Buchholz',
    buchholzCut1: 'Buchholz −1',
    sonnebornBerger: 'Sonneborn-Berger',
    opponentWinPct: "Opponents' win %",
    headToHead: 'Head-to-head',
  },
  // The shared bracket's words (BracketView, MatchCard of packages/ui), handed in by the app.
  bracket: {
    goldSilverMatch: 'Gold & Silver Match',
    bronzeMatch: 'Bronze Match',
    summary: '{rounds}-round bracket · bout slots: {count}',
    withBronze: ' · with a bronze match',
    winnersBracket: 'Winners Bracket',
    losersBracket: 'Losers Bracket',
    finals: 'Finals',
    playIns: 'Play-ins',
    lice: 'Lice: {name}',
    referee: 'Referee',
    overrideSlot: 'Change this slot',
  },
} as const satisfies MessageTree;
