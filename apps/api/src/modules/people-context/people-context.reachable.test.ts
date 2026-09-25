/**
 * The People hub shows only live profiles (operator ruling 112).
 *
 * The Following tab (`GET /me/following`) and the cards
 * (`GET /me/people/context`) built a card for every id they were given. A
 * fighter who erased their account, or whose profile was merged into another,
 * still appeared with their name and club. An erased or merged profile now gets
 * no card, exactly like an id that names no one, and the Following tab leaves
 * it out.
 */
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, type TableSeed } from '../../common/testing/supabase-chain';
import { MePeopleController } from './me-people.controller';
import { PeopleContextService } from './people-context.service';

const LIVE = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const ERASED = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const MERGED = '2d7e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';
const DELETED = '3e6f6d85-a08c-4d8a-8c88-4e4c6c8f5d34';
const VIEWER = '5d1c0f7e-2a8b-4c3d-9e6f-0a1b2c3d4e5f';

const person = (id: string, name: string, gone: Record<string, string> = {}) => ({
  id,
  slug: name.toLowerCase(),
  display_name: name,
  photo_url: null,
  country_code: null,
  public_visibility: {},
  hema_ratings_id: null,
  clubs: { name: 'Salle Rossi' },
  deleted_at: null,
  merged_into_id: null,
  account_deleted_at: null,
  ...gone,
});

const TABLES: Record<string, TableSeed> = {
  global_persons: {
    rows: [
      person(LIVE, 'Ana'),
      person(ERASED, 'Marie', { account_deleted_at: '2026-09-01T00:00:00Z' }),
      person(MERGED, 'Paul', { merged_into_id: LIVE }),
      person(DELETED, 'Luc', { deleted_at: '2026-09-01T00:00:00Z' }),
    ],
  },
  referee_assignments: { data: [], error: null },
  persons: { data: [], error: null },
  registrations: { data: [], error: null },
  referee_skills: { data: [], error: null },
};

function hub() {
  const supabase = mockSupabase(TABLES);
  const follows = {
    filterFollowedGlobalPersons: vi.fn().mockResolvedValue(new Set()),
    listDirectoryFollows: vi.fn().mockResolvedValue(
      [LIVE, ERASED, MERGED, DELETED].map((globalPersonId) => ({
        globalPersonId,
        followedAt: '2026-09-02T00:00:00Z',
      })),
    ),
    getEventFollowStateForGlobalPersons: vi.fn().mockResolvedValue(new Map()),
  };
  const people = new PeopleContextService(
    supabase as never,
    { getPoolStandings: vi.fn().mockResolvedValue({ rows: [] }) } as never,
    { getTournamentBracket: vi.fn().mockResolvedValue({ slots: [] }) } as never,
    follows as never,
  );
  const auth = { getAuthUser: vi.fn().mockResolvedValue({ id: VIEWER }) };
  const controller = new MePeopleController(people, follows as never, auth as never);
  return { people, controller };
}

const signedIn = { headers: { authorization: 'Bearer token' } } as never;

describe('the People hub shows only live profiles (ruling 112)', () => {
  it('gives a card to a live profile and none to an erased, merged or deleted one', async () => {
    const { people } = hub();

    const cards = await people.enrich([LIVE, ERASED, MERGED, DELETED], VIEWER);

    expect(cards.map((card) => card.displayName)).toEqual(['Ana']);
  });

  it('answers the public cards route about an erased profile like an unknown id', async () => {
    const { controller } = hub();

    await expect(controller.context(ERASED, signedIn)).resolves.toEqual([]);
  });

  it('leaves erased, merged and deleted profiles out of the Following tab', async () => {
    const { controller } = hub();

    const following = (await controller.following(signedIn)) as Array<{ displayName: string }>;

    expect(following.map((card) => card.displayName)).toEqual(['Ana']);
  });
});
