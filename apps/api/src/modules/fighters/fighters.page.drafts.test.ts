/**
 * A fighter's page and its reads by slug (ruling 174): a profile known only through entries
 * hidden from the public — here Léa, entered only in the draft Longsword Open — answers exactly
 * like an unknown slug, for everyone: the page, its career and referee stats 404 in the same
 * words, and its bout history too, by slug or by id. So does Jane, whose draft entry carried her
 * HEMA Ratings id and made her profile: her rating history is empty (ruling 176a). Anna, entered
 * in a public Tournament, is untouched, and so are Mia (claimed by her account) and Rita (made by
 * a super admin), though their only entry is a draft: a profile that stands on its own stays
 * public (rulings 176, 176a). So is Tom, entered only in the draft too, who referees at the public
 * Spring Open: added from his profile, he has no roster row there (ruling 177).
 */
import { HttpException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  queriedTables,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { FightersService } from './fighters.service';

const EVENT = {
  id: 'e-pub',
  status: 'published',
  organization_id: 'org-a',
  event_kind: 'standard',
};
// Hal's profile, read by id: a uuid.
const HAL = '00000000-0000-4000-8000-000000000001';
const UNKNOWN = '00000000-0000-4000-8000-000000000002';

// One registration row serves both reads: the draft bar's (person_id, tournament_id, status) and
// the bout history's (the persons embed).
const registration = (id: string, personId: string, profileId: string, tournamentId: string) => ({
  id,
  person_id: personId,
  tournament_id: tournamentId,
  status: 'registered',
  'persons.global_person_id': profileId,
  persons: { global_person_id: profileId },
  tournaments: { id: tournamentId, status: tournamentId === 't-open' ? 'published' : 'draft' },
});

// Made for a roster entry unless said otherwise.
const profile = (id: string, slug: string, over: Record<string, unknown> = {}) => ({
  id,
  slug,
  hema_ratings_id: null,
  claimed_by_user_id: null,
  made_outside_roster: false,
  ...over,
});

const NAMES = ['lea', 'anna', 'mia', 'rita', 'jane', 'hal', 'tom'];

const REGISTRATIONS = [
  registration('r-lea', 'p-lea', 'gp-lea', 't-secret'),
  registration('r-anna', 'p-anna', 'gp-anna', 't-open'),
  registration('r-mia', 'p-mia', 'gp-mia', 't-secret'),
  registration('r-rita', 'p-rita', 'gp-rita', 't-secret'),
  registration('r-jane', 'p-jane', 'gp-jane', 't-secret'),
  registration('r-hal-draft', 'p-hal', HAL, 't-secret'),
  registration('r-tom', 'p-tom', 'gp-tom', 't-secret'),
  // Hal withdrew from the public Tournament: no longer on its roster, but his bouts there are.
  {
    ...registration('r-hal-open', 'p-hal', HAL, 't-open'),
    status: 'withdrawn',
    tournaments: { id: 't-open', status: 'published', events: EVENT },
  },
];

// Tom referees at the public Spring Open, added from his profile.
const REFEREES = [
  {
    event_id: 'e-spring',
    person_id: 'gp-tom',
    events: { status: 'published', event_kind: 'standard' },
  },
];

function baseTables(): Record<string, TableSeed> {
  return {
    global_persons: {
      rows: [
        profile('gp-lea', 'lea'),
        profile('gp-anna', 'anna', { hema_ratings_id: 'hr-anna' }),
        profile('gp-mia', 'mia', { claimed_by_user_id: 'u-mia' }),
        profile('gp-rita', 'rita', { hema_ratings_id: 'hr-rita', made_outside_roster: true }),
        profile('gp-jane', 'jane', { hema_ratings_id: 'hr-jane' }),
        profile(HAL, 'hal'),
        profile('gp-tom', 'tom'),
      ],
    },
    events: { rows: [EVENT] },
    tournaments: {
      rows: [
        { id: 't-open', event_id: 'e-pub', status: 'published' },
        { id: 't-secret', event_id: 'e-pub', status: 'draft' },
      ],
    },
    persons: {
      rows: NAMES.map((name) => ({
        id: `p-${name}`,
        event_id: 'e-pub',
        global_person_id: name === 'hal' ? HAL : `gp-${name}`,
      })),
    },
    registrations: { rows: REGISTRATIONS },
    event_referees: { rows: REFEREES },
    event_instructors: { rows: [] },
    referee_assignments: { rows: [] },
    fighter_clubs: { rows: [] },
    fighter_weapons: { rows: [] },
    fighter_manual_medals: { rows: [] },
    matches: { data: [], error: null, count: 0 },
  };
}

let db: ReturnType<typeof mockSupabase>;
const ratings = {
  getRatingHistory: vi.fn(async (id: string) => [{ id, rating: 1500 }]),
  getProfile: vi.fn(async (id: string) => ({ id })),
};

function service() {
  return new FightersService({ service: db.service } as never, {} as never, ratings as never);
}

const refusal = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (err: unknown) => err,
  );
const notFound = (slug: string) =>
  expect.objectContaining({
    constructor: NotFoundException,
    message: `Fighter "${slug}" not found`,
  });

beforeEach(() => {
  db = mockSupabase(baseTables());
  ratings.getRatingHistory.mockClear();
});

describe('a fighter known only through hidden entries answers like an unknown one (ruling 174)', () => {
  it('404s her page in the words of an unknown slug', async () => {
    expect(await refusal(service().getBySlug('nobody'))).toEqual(notFound('nobody'));
    expect(await refusal(service().getBySlug('lea'))).toEqual(notFound('lea'));
    expect(await refusal(service().getBySlug('jane'))).toEqual(notFound('jane'));
  });

  it("404s her career and her referee stats, and not a public fighter's", async () => {
    expect(await refusal(service().getCareerBySlug('lea'))).toEqual(notFound('lea'));
    expect(await refusal(service().getRefereeStatsBySlug('lea'))).toEqual(notFound('lea'));
    expect(await refusal(service().getRefereeStatsBySlug('nobody'))).toEqual(notFound('nobody'));
    expect(await refusal(service().getRefereeStatsBySlug('anna'))).toBeNull();
  });

  it("404s her bout history by slug, and not a public fighter's", async () => {
    expect(await refusal(service().listMatchesPaginated('lea', { limit: 20, offset: 0 }))).toEqual(
      notFound('lea'),
    );
    expect(await service().listMatchesPaginated('anna', { limit: 20, offset: 0 })).toEqual({
      items: [],
      total: 0,
    });
  });

  it('answers his bout history by id exactly like an unknown id, reading no bout', async () => {
    const page = { limit: 20, offset: 0 };
    const unknown = await service().listMatchesPaginated(UNKNOWN, page);
    expect(await service().listMatchesPaginated(HAL, page)).toEqual(unknown);
    expect(unknown).toEqual({ items: [], total: 0 });
    expect(queriedTables(db.from)).not.toContain('matches');
  });

  it("answers Jane's rating history empty, as for an unknown slug, asking the ratings nothing", async () => {
    expect(await service().getRatingHistoryBySlug('nobody')).toEqual({ series: [] });
    expect(await service().getRatingHistoryBySlug('jane')).toEqual({ series: [] });
    expect(ratings.getRatingHistory).not.toHaveBeenCalled();
    expect(await service().getRatingHistoryBySlug('anna')).toEqual({
      series: [{ id: 'hr-anna', rating: 1500 }],
    });
    // The double ignores projections: only this pin sees the id the check needs go.
    expect(selectsFor(db.from, 'global_persons')).toContain('id, hema_ratings_id');
  });

  it("reads each profile's roster rows, and 5xxs when they cannot be read", async () => {
    await refusal(service().getCareerBySlug('lea'));
    expect(selectsFor(db.from, 'persons')[0]).toBe('id, event_id, global_person_id');
    db = mockSupabase({ ...baseTables(), persons: { data: null, error: { message: 'boom' } } });
    const failure = await refusal(service().getBySlug('lea'));
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(NotFoundException);
    expect(String(failure)).toContain('profile roster read failed: boom');
  });

  it('5xxs when the profile cannot be read by slug, never a 404 or a 400', async () => {
    db = mockSupabase({
      ...baseTables(),
      global_persons: { data: null, error: { message: 'boom' } },
    });
    for (const call of [
      service().getCareerBySlug('anna'),
      service().getRefereeStatsBySlug('anna'),
      service().listMatchesPaginated('anna', { limit: 20, offset: 0 }),
    ]) {
      const failure = await refusal(call);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(HttpException);
      expect(String(failure)).toContain('fighter read failed: boom');
    }
  });
});

describe("a claimed fighter or a super admin's keeps her page whatever her entries (rulings 176, 176a)", () => {
  it('answers her page', async () => {
    for (const slug of ['mia', 'rita']) {
      expect(await service().getBySlug(slug)).toMatchObject({ slug });
    }
  });

  it('answers her referee stats and her bout history by slug', async () => {
    for (const slug of ['mia', 'rita']) {
      expect(await refusal(service().getRefereeStatsBySlug(slug))).toBeNull();
      expect(await service().listMatchesPaginated(slug, { limit: 20, offset: 0 })).toEqual({
        items: [],
        total: 0,
      });
    }
  });

  it('answers her rating history', async () => {
    expect(await service().getRatingHistoryBySlug('rita')).toEqual({
      series: [{ id: 'hr-rita', rating: 1500 }],
    });
  });
});

describe('a referee of a public Event keeps his page whatever his entries (ruling 177)', () => {
  it('answers his page, his referee stats and his bout history by slug', async () => {
    expect(await service().getBySlug('tom')).toMatchObject({ slug: 'tom' });
    expect(await refusal(service().getRefereeStatsBySlug('tom'))).toBeNull();
    expect(await service().listMatchesPaginated('tom', { limit: 20, offset: 0 })).toEqual({
      items: [],
      total: 0,
    });
  });
});
