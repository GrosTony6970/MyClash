import { expect, type Page } from '@playwright/test';
import { PUBLIC, signInAsLea } from './me-stub';

/**
 * A signed-in fighter on `/me/profile`, with no API behind it.
 *
 * The page reads its dashboard and the weapon list in the browser; the catch-all `{}` of
 * `signInAsLea` would make `formFromProfile` throw, so both are answered here with the API's
 * shapes. Every PATCH of the profile is recorded, and answered with the profile it sent, as the
 * API answers with the saved row. Register a story's own routes AFTER this call.
 */

export { PUBLIC };

const WEAPONS = [
  { id: 'w-1', name: 'Longsword' },
  { id: 'w-2', name: 'Sabre' },
];

const STAT = {
  matches: 0,
  wins: 0,
  losses: 0,
  winLossRatio: null,
  doubleHits: 0,
  exchanges: 0,
  doublePercentage: 0,
  doubleHitPercentage: 0,
};

export interface ProfileFixture {
  practicing_since_year?: number | null;
  medals?: Array<{ competition: string; year: number; rank: number; weapon: string }>;
  bio?: string | null;
}

/** The profile the API answers with: the dashboard's, and a save's. */
export function profileOf(fixture: ProfileFixture) {
  return {
    id: 'gp-1',
    slug: 'lea-martin',
    display_name: 'Léa Martin',
    given_name: 'Léa',
    family_name: 'Martin',
    country_code: 'FR',
    dateOfBirth: null,
    bio: fixture.bio ?? null,
    alias: null,
    website_url: null,
    instagram_url: null,
    youtube_url: null,
    practicing_since_year: fixture.practicing_since_year ?? null,
    public_visibility: {},
    listed_in_directory: true,
    search_indexable: false,
    photo_url: null,
    clubs: [],
    weapons: [],
    medals: fixture.medals ?? [],
  };
}

function dashboardOf(fixture: ProfileFixture) {
  return {
    profile: profileOf(fixture),
    career: {
      eventParticipation: [],
      tournamentPlacements: [],
      tournamentsAttended: 0,
      upcoming: [],
      leagueRankings: [],
      recentForm: [],
      currentStreak: { kind: 'none', count: 0 },
      stats: { overall: STAT, byWeapon: [], byYear: [], byEvent: [] },
      penalties: [],
    },
    hemaRatings: null,
  };
}

export interface ProfilePage {
  /** The parsed body of every PATCH of the profile, in order. */
  saves: Array<Record<string, unknown>>;
}

export async function openProfile(page: Page, fixture: ProfileFixture = {}): Promise<ProfilePage> {
  const saves: ProfilePage['saves'] = [];
  await signInAsLea(page);
  // No insight written yet: the API answers null.
  await page.route('**/api/v1/me/insight*', (route) => route.fulfill({ json: null }));
  await page.route('**/api/v1/weapons', (route) => route.fulfill({ json: WEAPONS }));
  // The Referee tab: a fighter who has refereed nothing yet.
  await page.route('**/api/v1/fighters/me/referee-stats', (route) =>
    route.fulfill({ json: { history: [], bestBuddies: [] } }),
  );
  await page.route('**/api/v1/fighters/me/dashboard', (route) =>
    route.fulfill({ json: dashboardOf(fixture) }),
  );
  await page.route('**/api/v1/fighters/me/profile', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    saves.push(body);
    const medals = (body.medals as ProfileFixture['medals']) ?? [];
    await route.fulfill({
      json: profileOf({
        practicing_since_year: (body.practicingSinceYear as number | null) ?? null,
        medals,
        bio: (body.bio as string | undefined) ?? null,
      }),
    });
  });
  await page.goto(`${PUBLIC}/me/profile`);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  return { saves };
}
