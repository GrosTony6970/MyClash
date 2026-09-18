// Shared client types for the redesigned /me personal space. Mirror the API
// shapes returned by the `me` module + the per-event my-schedule endpoint.

import type { EventKind } from '@myclash/types';

export interface ScheduleMatch {
  id: string;
  matchNumberLabel: string;
  status: string;
  scheduledAt: string | null;
  /** The bout's planned length in minutes, from the Event's planner sheet or the
   *  bout's own override (ADR-018). Null when the API could not read the sheet:
   *  no length is invented for it, and the bout ends at `fallbackEndsAt`, if any. */
  durationMinutes: number | null;
  /** Where the bout ends when it has no length: its next bout on the piste, or the
   *  day's next break or admin bar — the API's fallback, never a second length.
   *  Null when nothing follows it that day; absent in a copy cached before the
   *  API sent it. */
  fallbackEndsAt?: string | null;
  opponentName: string | null;
  redScore: number;
  blueScore: number;
  isRed: boolean;
  /** The tournament's configured fighter-side colour tokens. Per match, since a
   *  personal schedule spans tournaments with different palettes. */
  sideColors?: { red: string; blue: string } | null;
  /** The bout's Pool — the key into `PersonSchedule.poolSpans`. Null for a Swiss or
   *  bracket bout; absent in a copy cached before the API sent it. */
  poolId?: string | null;
  poolName: string | null;
  tournamentName: string | null;
  /** Tournament (competition) id — pairs with `phase` to key the scheduled
   *  programme block, so the section header ends no earlier than the block's end
   *  (e.g. 11:30). Null when unresolved. */
  tournamentId: string | null;
  /** Coarse programme phase for block lookup — the PROGRAMME taxonomy, which
   *  carries `swiss` as a 4th token. Null unknown. */
  phase: 'pool' | 'swiss' | 'bracket' | null;
  liceName: string | null;
}

export interface RefereeSlot {
  /** referee_assignments.id — stable render key. `matchId` is '' for every
   *  pool-/lice-scoped row, so it cannot serve as one. */
  id: string;
  matchId: string;
  matchNumberLabel: string;
  scheduledAt: string | null;
  /** The duty's planned window, worked out by the API from the Matches it covers
   *  (its own Match, or its Pool's placed Matches). Null when nothing is placed. */
  startsAt: string | null;
  endsAt: string | null;
  role: string;
  poolName: string | null;
  poolId: string | null;
  tournamentName: string | null;
  tournamentSlug: string | null;
  liceName: string | null;
  /** 'pool' | 'play_in' | 'final' | 'semi_final' | 'quarter_final' | 'round_of' | 'swiss' | null */
  matchKind: string | null;
  roundOfCount: number | null;
  /** Which Swiss round, for matchKind === 'swiss'. Keys the per-round referee
   *  card — without it five rounds of duty fold into one. */
  swissRound: number | null;
  bracketSlotId: string | null;
  skillName: string | null;
  skillColor: string | null;
  /** For a whole-pool role (e.g. "Déclarant"), the number of matches in the pool
   *  the person covers, so the card shows the real bout count instead of "1". */
  poolMatchCount: number | null;
}

export interface WorkshopEnrollment {
  /** workshop_sessions.id (the enrolled session), NOT the parent workshop id. */
  workshopId: string;
  /** Parent workshop slug — deep-links to the workshop in the Workshops tab. */
  workshopSlug: string | null;
  workshopName: string;
  sessionStart: string | null;
  sessionEnd: string | null;
  location: string | null;
}

/** One of the fighter's Pools, from its earliest placed bout to the planned end of
 *  its last, whoever fights them — a fighter is busy for all of it. Null times
 *  where the API could not work them out. */
export interface PoolSpan {
  poolId: string;
  poolName: string | null;
  tournamentName: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

export interface PersonSchedule {
  personId: string;
  matches: ScheduleMatch[];
  /** The Pools of `matches`. Absent in a copy cached before the API sent it. */
  poolSpans?: PoolSpan[];
  refereeSlots: RefereeSlot[];
  workshops: WorkshopEnrollment[] | null;
}

/** A non-commitment programme block (lunch, ceremony, registration…) shown as
 *  context within a schedule day. `start`/`end` are resolved to UTC ISO from the
 *  block's wall-clock time + the event timezone. */
export interface ProgrammeContextRow {
  id: string;
  label: string;
  start: string;
  end: string | null;
  /** 'admin' | 'break' — selects the default accent when there's no colorHex. */
  blockType: string;
  /** Organiser-chosen "#rrggbb" tint for the bar; null = DEFAULT_BLOCK_ACCENT. */
  colorHex: string | null;
}

export interface MyEventInfo {
  id: string;
  slug: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  timezone: string | null;
  /** 'standard' | 'club' — the API drops test events from /me entirely. */
  kind: EventKind;
}

export interface MyEventTournament {
  id: string;
  slug: string;
  name: string;
  weapon: string | null;
  registered: boolean;
  registrationId: string | null;
  poolName: string | null;
  /**
   * Swiss progress for this fighter's tournament — rounds done out of rounds
   * configured. Both null when the tournament has no Swiss phase.
   *
   * Deliberately NOT their points: those belong to SwissStandingsService, and a
   * second implementation here would be a second owner of the scoring.
   */
  swissRoundsCompleted: number | null;
  swissRoundCount: number | null;
  seed: number | null;
  bibNumber: number | null;
}

export interface MyEventRefereeOf {
  /** referee_assignments.id — stable render key (a pool-scoped duty carries no
   *  match id, so two pool duties would otherwise collide). */
  id: string;
  tournamentName: string | null;
  poolName: string | null;
  role: string | null;
  skillName: string | null;
  skillColor: string | null;
  liceName: string | null;
  venueName: string | null;
  /** 'pool' | 'play_in' | 'final' | 'semi_final' | 'quarter_final' | 'round_of' | 'swiss' | null */
  matchKind: string | null;
  roundOfCount: number | null;
  /** Which Swiss round, for matchKind === 'swiss'. Null otherwise. */
  swissRound: number | null;
  /** Bracket slot id for match-scoped assignments (null otherwise) — used to
   *  self-highlight the viewer's own bracket match. */
  bracketSlotId: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

/** A workshop the signed-in user TEACHES at the event (mirrors the API shape).
 *  Distinct from `WorkshopEnrollment` (a workshop the user attends). */
export interface MyEventWorkshopTeaching {
  workshopId: string;
  workshopSlug: string | null;
  workshopName: string;
  sessionStart: string | null;
  sessionEnd: string | null;
  location: string | null;
}

export interface MyEvent {
  event: MyEventInfo;
  roles: {
    isCompetitor: boolean;
    isReferee: boolean;
    isWorkshopParticipant: boolean;
    isInstructor: boolean;
  };
  tournaments: MyEventTournament[];
  refereeOf: MyEventRefereeOf[];
  /** Workshops the user teaches at this event (empty for roster-only instructors). */
  workshopsTeaching: MyEventWorkshopTeaching[];
  counts: { matches: number; refereeSlots: number; workshops: number };
}

export interface UpcomingItem {
  kind: 'fight' | 'referee';
  eventId: string;
  eventSlug: string;
  eventName: string;
  eventTimezone: string | null;
  scheduledAt: string;
  matchId: string;
  matchNumberLabel: string;
  tournamentName: string | null;
  poolName: string | null;
  liceName: string | null;
  opponentName: string | null;
  isRed: boolean | null;
  role: string | null;
}
