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
 *   - matches are camelCase ScheduleGridMatch (schedule-grid.service.ts:5)
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

export const meFixture = {
  type: 'claimed',
  admin: { platformRole: null, organizations: [{ slug: ORG_SLUG }], hasLeagueRoles: false },
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
    phaseType: 'pool',
    poolId: null,
    poolName: null,
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
      matchId: MATCH_2,
      personId: REFEREE_PERSON,
      personName: 'Denis Referee',
      role: 'arbitre_declarant',
    },
  ],
  registrations: [
    { registrationId: 'reg-red', personId: REFEREE_PERSON, personName: 'Denis Referee' },
  ],
};

/**
 * The lagging half, clean. Every check on, nothing found — so the banner stays
 * hidden until the drag produces a live finding, and the group can then be
 * asserted to carry this exact time.
 */
export const refereeCrewConflictsFixture = {
  conflicts: [],
  rules: { officiateVsFight: true, doubleBooked: true, availability: true },
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
    matchGapSeconds: 0,
    matchDurationMinutes: 5,
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
    matchGapSeconds: 0,
    matchDurationMinutes: 0,
    colorHex: null,
    generatedAt: null,
  },
];
