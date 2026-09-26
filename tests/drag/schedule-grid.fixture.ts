/**
 * Fixture payloads for the schedule-grid drag spec.
 *
 * The grid bootstraps from four endpoints (grid.tsx's mount effect):
 *   /lices  /schedule  /events/:id  /programme
 * and every one is mocked here, so this spec needs no API and no database —
 * which is the only reason it can run per-commit. tests/e2e/* need a deployed
 * stack and run nightly; a net that reds 24h after the commit that broke it is
 * not a net for a refactor.
 *
 * Shapes are copied from the real projections, not invented:
 *   - lices are SNAKE_CASE with an embedded venue (lices.service.ts:29)
 *   - matches are camelCase ScheduleGridMatch (schedule-grid-match.ts)
 *   - programme blocks are camelCase ProgrammeBlock (programme.service mapBlock)
 * A fixture that drifts from those is worse than no fixture: it would keep
 * passing while the real grid broke.
 */

export const ORG_SLUG = 'test-org';
export const EVENT_ID = 'aaba08c8-f692-49ac-ace3-45ce2c58ef8a';

/** Europe/Paris, deliberately: the axis is built in the EVENT's zone, and a
 *  UTC fixture on a UTC runner cannot tell a zone bug from a correct one. */
export const EVENT_TZ = 'Europe/Paris';
export const DAY = '2026-06-06';

export const LICE_A = '11111111-1111-4111-8111-111111111111';
export const LICE_B = '22222222-2222-4222-8222-222222222222';

export const MATCH_1 = '33333333-3333-4333-8333-333333333333';
export const MATCH_2 = '44444444-4444-4444-8444-444444444444';
export const BREAK_BLOCK = '55555555-5555-4555-8555-555555555555';
export const COMP_BLOCK = '66666666-6666-4666-8666-666666666666';

/** `HH:MM` on the fixture day, as the event zone's wall clock, in ISO. */
export function at(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  // Paris is UTC+2 in June; the grid reads these back through the event tz.
  const utcHour = (h ?? 0) - 2;
  return `${DAY}T${String(utcHour).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}:00.000Z`;
}

/** A `/api/v1/me` body for the owner of ORG_SLUG, shaped after `MeResponseDto`
 *  by hand — root `tests/` is not a workspace, so no compiler checks it. Every
 *  membership field is filled because the API cannot emit a partial row
 *  (`normalizeOrganizationMembership`, auth.service.ts:94, drops any row missing
 *  id, slug, name or role) and `workspace-options.ts:70-79` reads `name` and
 *  sorts on it. Consumers: this spec's harness and tests/a11y/admin-wizard.spec.ts. */
export const meFixture = {
  type: 'claimed',
  admin: {
    platformRole: null,
    organizations: [
      {
        id: '77777777-7777-4777-8777-777777777777',
        slug: ORG_SLUG,
        name: 'Test Org',
        role: 'owner',
      },
    ],
    hasLeagueRoles: false,
  },
};

export const eventFixture = {
  id: EVENT_ID,
  slug: 'fixture-cup',
  name: 'Fixture Cup',
  start_date: DAY,
  end_date: DAY,
  timezone: EVENT_TZ,
  status: 'published',
};

export const licesFixture = [
  {
    id: LICE_A,
    event_id: EVENT_ID,
    name: 'Piste 1',
    sort_order: 0,
    venue_id: null,
    area_id: null,
    color_hex: null,
    location_label: null,
    venues: null,
    venue_areas: null,
  },
  {
    id: LICE_B,
    event_id: EVENT_ID,
    name: 'Piste 2',
    sort_order: 1,
    venue_id: null,
    area_id: null,
    color_hex: null,
    location_label: null,
    venues: null,
    venue_areas: null,
  },
];

function match(over: Record<string, unknown>) {
  return {
    matchNumberLabel: 'M1',
    roundCode: 'LSW-P1-M1',
    status: 'scheduled',
    startedAt: null,
    endedAt: null,
    redFighterName: 'Red Fighter',
    blueFighterName: 'Blue Fighter',
    redRegistrationId: 'reg-red',
    blueRegistrationId: 'reg-blue',
    tournamentName: 'Longsword Open',
    tournamentColor: null,
    tournamentSlug: 'longsword-open',
    durationMinutes: 5,
    plannedDurationOverrideMinutes: null,
    phaseType: 'pool',
    poolId: null,
    poolName: null,
    poolRestMinutes: null,
    ...over,
  };
}

/** Two matches on two different pistes, an hour apart, so a drag between them
 *  is unambiguous and neither is already where the drag would put it. */
export const scheduleFixture = [
  match({
    id: MATCH_1,
    matchNumberLabel: 'M1',
    roundCode: 'LSW-P1-M1',
    liceId: LICE_A,
    scheduledAt: at('10:00'),
  }),
  match({
    id: MATCH_2,
    matchNumberLabel: 'M2',
    roundCode: 'LSW-P1-M2',
    liceId: LICE_B,
    scheduledAt: at('12:00'),
    redFighterName: 'Third Fighter',
    blueFighterName: 'Fourth Fighter',
    // Its own registrations. They used to be the `match()` defaults, so both
    // bouts carried the same two ids while showing four different names — and
    // any drag that overlapped them raised a fighter double-booking that the
    // fixture never meant to describe.
    redRegistrationId: 'reg-red-2',
    blueRegistrationId: 'reg-blue-2',
  }),
];

/**
 * The two-bout board plus a third bout nobody has placed yet. It has no Pool, so
 * the Unscheduled panel shows it as its own chip, draggable and labelled with
 * its round code — which is what lets `dragCardToCell` pick it up from there.
 */
export const MATCH_3 = '99999999-9999-4999-8999-999999999999';
export const unscheduledFixture = [
  ...scheduleFixture,
  match({
    id: MATCH_3,
    matchNumberLabel: 'M3',
    roundCode: 'LSW-P1-M3',
    liceId: null,
    scheduledAt: null,
    redFighterName: 'Fifth Fighter',
    blueFighterName: 'Sixth Fighter',
    redRegistrationId: 'reg-red-3',
    blueRegistrationId: 'reg-blue-3',
  }),
];

/**
 * One Pool of six bouts on Piste 1 from 10:43, five minutes apart — a run that
 * does NOT start on a 5-minute slot. Its window shows the slot, 10:40, so a save
 * that read that text back would move the whole run three minutes early.
 */
export const RUN_START = at('10:43');
export const RUN_MATCH_IDS = [1, 2, 3, 4, 5, 6].map(
  (n) => `88888888-8888-4888-8888-00000000000${n}`,
);
export function runScheduleFixture(typedLengthMinutes: number | null = null) {
  const length = typedLengthMinutes ?? 5;
  return RUN_MATCH_IDS.map((id, index) =>
    match({
      id,
      matchNumberLabel: `M${index + 1}`,
      roundCode: `LSW-PA-M${index + 1}`,
      liceId: LICE_A,
      scheduledAt: new Date(Date.parse(RUN_START) + index * length * 60_000).toISOString(),
      durationMinutes: length,
      plannedDurationOverrideMinutes: typedLengthMinutes,
      poolId: 'pool-a',
      poolName: 'Pool A',
      // Six bouts, twelve fighters: shared defaults would raise a double booking.
      redRegistrationId: `reg-red-run-${index}`,
      blueRegistrationId: `reg-blue-run-${index}`,
    }),
  );
}

/**
 * The same day, running twenty minutes behind on Piste 1.
 *
 * `computeLiceDrift` measures a piste off its RUNNING bout: M1 was planned for
 * 10:00 and went on at 10:20. That is the only way to make the whole-day
 * running-late control appear, because a board with nothing started has no
 * drift to offer and deliberately shows no button.
 *
 * M2 stays waiting at 12:00, so with the clock at 11:00 there is exactly one
 * fight and one bar (Lunch) after the cut — small enough to assert exactly.
 */
export const LATE_START = at('10:20');
export const lateScheduleFixture = [
  match({
    id: MATCH_1,
    matchNumberLabel: 'M1',
    roundCode: 'LSW-P1-M1',
    liceId: LICE_A,
    scheduledAt: at('10:00'),
    status: 'running',
    startedAt: LATE_START,
  }),
  match({
    id: MATCH_2,
    matchNumberLabel: 'M2',
    roundCode: 'LSW-P1-M2',
    liceId: LICE_B,
    scheduledAt: at('12:00'),
    redFighterName: 'Third Fighter',
    blueFighterName: 'Fourth Fighter',
    redRegistrationId: 'reg-red-2',
    blueRegistrationId: 'reg-blue-2',
  }),
];

/** `global_persons.id` — deliberately unlike any registration id above, because
 *  the whole referee check turns on those two spaces not being confused. */
export const REFEREE_PERSON = 'gp-denis';

/**
 * Denis fights M1 and referees M2. At the fixture's own times, 10:00 and 12:00,
 * that is fine and the board says nothing. Drag M1 next to M2 and it is hard
 * rule 8 — which is what the referee spec drags.
 */
export const refereeMatchAssignmentsFixture = {
  assignments: [
    {
      scopeType: 'match',
      matchId: MATCH_2,
      poolId: null,
      personId: REFEREE_PERSON,
      personName: 'Denis Referee',
      role: 'arbitre_declarant',
      confirmedReasons: [],
    },
  ],
  registrations: [
    { registrationId: 'reg-red', personId: REFEREE_PERSON, personName: 'Denis Referee' },
  ],
  rules: {
    ownPool: true,
    ownPoolSpan: true,
    twoRoles: true,
    attendWorkshop: true,
    restSlots: 1,
    maxBoutsPerDay: 0,
  },
};

/**
 * The lagging half, clean. Every check on, nothing found — so the banner stays
 * hidden until the drag produces a live finding, and the group can then be
 * asserted to carry this exact time.
 */
export const refereeCrewConflictsFixture = {
  conflicts: [],
  rules: {
    ownPool: true,
    ownPoolSpan: true,
    twoRoles: true,
    attendWorkshop: true,
    restSlots: 1,
    maxBoutsPerDay: 0,
  },
  asOf: at('09:30'),
};

export const programmeFixture = [
  {
    id: COMP_BLOCK,
    eventId: EVENT_ID,
    dayIndex: 0,
    sortOrder: 0,
    blockType: 'competition',
    label: 'Pools',
    competitionId: null,
    competitionPhase: null,
    workshopId: null,
    liceCount: 2,
    startTime: '09:00',
    endTime: '18:00',
    colorHex: null,
    generatedAt: null,
  },
  {
    id: BREAK_BLOCK,
    eventId: EVENT_ID,
    dayIndex: 0,
    sortOrder: 1,
    blockType: 'break',
    label: 'Lunch',
    competitionId: null,
    competitionPhase: null,
    workshopId: null,
    liceCount: 0,
    startTime: '13:00',
    endTime: '14:00',
    colorHex: null,
    generatedAt: null,
  },
];

/**
 * The planner sheet as `GET /programme/config` returns it for an Event with no
 * saved sheet: the schema's defaults (programme.dto.ts, PROGRAMME_CONFIG_DEFAULTS).
 */
export const sheetFixture = {
  dayStartTime: '08:00',
  dayEndTime: '19:00',
  middayBreakStart: '12:00',
  middayBreakMinutes: 60,
  poolMatchDurationMinutes: 5,
  eliminationMatchDurationMinutes: 8,
  finalsMatchDurationMinutes: 10,
  matchGapSeconds: 10,
  minRestMinutes: 10,
  tournaments: [],
  breakBetweenSessionsMinutes: 10,
  refereeMeetingDurationMinutes: 30,
  arrivalAndGearCheckMinutes: 90,
};
