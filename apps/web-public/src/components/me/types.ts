// Shared client types for the redesigned /me personal space. Mirror the API
// shapes returned by the `me` module + the per-event my-schedule endpoint.

export interface ScheduleMatch {
  id: string;
  matchNumberLabel: string;
  status: string;
  scheduledAt: string | null;
  opponentName: string | null;
  redScore: number;
  blueScore: number;
  isRed: boolean;
  poolName: string | null;
  tournamentName: string | null;
  liceName: string | null;
}

export interface RefereeSlot {
  matchId: string;
  matchNumberLabel: string;
  scheduledAt: string | null;
  /** The assignment's own window — set for pool-/lice-scoped rows with no match,
   *  so the schedule can place them on a day even without a per-match time. */
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

export interface PersonSchedule {
  personId: string;
  matches: ScheduleMatch[];
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
  /** 'admin' | 'break' — drives the neutral vs. accented default when no colorHex. */
  blockType: string;
  /** Admin-chosen "#rrggbb" tint for the bar; null = per-kind default. */
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
}

export interface MyEventTournament {
  id: string;
  slug: string;
  name: string;
  weapon: string | null;
  registered: boolean;
  registrationId: string | null;
  poolName: string | null;
  seed: number | null;
  bibNumber: number | null;
}

export interface MyEventRefereeOf {
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
  /** Bracket slot id for match-scoped assignments (null otherwise) — used to
   *  self-highlight the viewer's own bracket match. */
  bracketSlotId: string | null;
  startsAt: string | null;
  endsAt: string | null;
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
