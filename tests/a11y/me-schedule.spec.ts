import { test, expect, type Page } from '@playwright/test';
import {
  collectPageIssues,
  expectNoCriticalAxeViolations,
  expectNoPageIssues,
  stubPublicApi,
} from './helpers';

/**
 * The two /me pages that check a fighter's commitments for clashes, on a day the
 * API could not read the Event's sheet: no bout has a length. The personal space
 * is client-side, so a signed-in fighter is three stubbed reads away: who is
 * asking, their Events, their schedule.
 *
 * Ada fights Pool 1 on Lice 1 (Paris, UTC+1 in March). Her 10:00 bout ends where
 * the API fell back on — the next bout on the piste, 10:25. Her 10:30 bout is the
 * day's last there and has no end; so has her referee duty the next day. Two of
 * her commitments cannot be checked.
 */

const EVENT = {
  id: 'event-1',
  slug: 'test-event',
  name: 'Test Event',
  startDate: '2027-03-13',
  endDate: '2027-03-14',
  status: 'published',
  timezone: 'Europe/Paris',
  kind: 'standard',
};

const bout = (
  id: string,
  scheduledAt: string,
  opponentName: string,
  fallbackEndsAt: string | null,
) => ({
  id,
  matchNumberLabel: `Pool 1 - ${id}`,
  status: 'scheduled',
  scheduledAt,
  durationMinutes: null,
  fallbackEndsAt,
  opponentName,
  redScore: 0,
  blueScore: 0,
  isRed: true,
  poolId: 'pool-1',
  poolName: 'Pool 1',
  tournamentName: 'Longsword Open',
  tournamentId: 'tournament-1',
  phase: 'pool',
  liceName: 'Lice 1',
});

const SCHEDULE = {
  personId: 'person-1',
  matches: [
    bout('Match 1', '2027-03-13T09:00:00.000Z', 'Mary Somerville', '2027-03-13T09:25:00.000Z'),
    bout('Match 4', '2027-03-13T09:30:00.000Z', 'Emmy Noether', null),
  ],
  poolSpans: [
    {
      poolId: 'pool-1',
      poolName: 'Pool 1',
      tournamentName: 'Longsword Open',
      startsAt: '2027-03-13T09:00:00.000Z',
      endsAt: null,
    },
  ],
  refereeSlots: [
    {
      id: 'duty-1',
      matchId: 'match-2',
      matchNumberLabel: 'Pool 2 - Match 3',
      scheduledAt: '2027-03-14T10:00:00.000Z',
      startsAt: '2027-03-14T10:00:00.000Z',
      endsAt: null,
      role: 'skill-1',
      poolName: 'Pool 2',
      poolId: 'pool-2',
      tournamentName: 'Longsword Open',
      tournamentSlug: 'longsword-open',
      liceName: 'Lice 2',
      matchKind: 'pool',
      roundOfCount: null,
      swissRound: null,
      bracketSlotId: null,
      skillName: 'Referee',
      skillColor: 'slate',
      poolMatchCount: null,
    },
  ],
  workshops: [
    {
      workshopId: 'session-1',
      workshopSlug: 'stick-and-guard',
      workshopName: 'Stick and guard',
      sessionStart: '2027-03-13T09:10:00.000Z',
      sessionEnd: '2027-03-13T09:20:00.000Z',
      location: 'Room B',
    },
  ],
};

/** A session Ada has not joined, inside her first bout's fallback window. */
const OPEN_WORKSHOP = {
  id: 'workshop-2',
  slug: 'messer-basics',
  title: 'Messer basics',
  shortDescription: null,
  descriptionMd: null,
  category: null,
  level: null,
  weapon: null,
  language: null,
  color: null,
  coverImageUrl: null,
  capacity: null,
  durationMinutes: 10,
  sessions: [
    {
      id: 'session-2',
      startsAt: '2027-03-13T09:15:00.000Z',
      endsAt: '2027-03-13T09:22:00.000Z',
      locationLabel: 'Room C',
      venue: null,
      area: null,
      capacity: null,
      confirmedCount: 0,
      status: 'scheduled',
    },
  ],
  instructors: [],
};

async function signIn(page: Page): Promise<void> {
  await stubPublicApi(page);
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({
      json: {
        type: 'claimed',
        user: { id: 'user-1', email: 'ada@example.test', display_name: 'Ada' },
      },
    }),
  );
  await page.route('**/api/v1/me/events', (route) =>
    route.fulfill({
      json: [
        {
          event: EVENT,
          roles: {
            isCompetitor: true,
            isReferee: true,
            isWorkshopParticipant: true,
            isInstructor: false,
          },
          tournaments: [],
          refereeOf: [],
          workshopsTeaching: [],
          counts: { matches: 2, refereeSlots: 1, workshops: 1 },
        },
      ],
    }),
  );
  await page.route('**/api/v1/events/event-1/my-schedule', (route) =>
    route.fulfill({ json: SCHEDULE }),
  );
  await page.route('**/api/v1/events/test-event/public-workshops', (route) =>
    route.fulfill({ json: [OPEN_WORKSHOP] }),
  );
}

const LINE =
  "We couldn't work out when 2 of your commitments end, so they aren't checked for clashes.";

test('/me schedule - a bout with no length ends at its next bout, and the page says what it cannot check', async ({
  page,
}) => {
  const issues = collectPageIssues(page);
  await signIn(page);
  await page.goto('http://localhost:3001/me/events/test-event/schedule');

  await expect(page.getByText(LINE)).toBeVisible();
  // The first bout runs to 10:25, over the workshop; the second bout, the Pool and
  // the duty have no end and clash with nothing.
  await expect(page.getByText('Conflicts with: Stick and guard')).toHaveCount(1);
  await expect(page.getByText('Conflicts with: Mary Somerville')).toHaveCount(1);
  await expect(page.getByText(/Conflicts with/)).toHaveCount(2);

  await expectNoCriticalAxeViolations(page);
  await expectNoPageIssues(issues);
});

test('/me workshops - an open session inside a bout that ends at its next bout conflicts with it', async ({
  page,
}) => {
  const issues = collectPageIssues(page);
  await signIn(page);
  await page.goto('http://localhost:3001/me/events/test-event/workshops');

  // The 10:30 bout and the duty, as on the schedule tab.
  await expect(page.getByText(LINE)).toBeVisible();
  await expect(page.getByText('Conflicts with Mary Somerville (10:00–10:25)')).toBeVisible();

  await expectNoCriticalAxeViolations(page);
  await expectNoPageIssues(issues);
});
