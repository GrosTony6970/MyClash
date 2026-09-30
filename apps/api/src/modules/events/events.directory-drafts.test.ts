/**
 * The Events directory `GET /events` (ruling 129 family 5, ruling 163): a page that spans many
 * Events shows public things only, for everyone — no Event's club is asked who the caller is.
 * A draft Event is never listed, whatever `status` asks for; its Tournament count, the weapon
 * filter and the league tags count only published, running and completed Tournaments. A league
 * tag names only a published, publicly visible league (ruling 88): a draft or private one answers
 * as no link.
 */
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { EventsService } from './events.service';

const PUBLIC = ['published', 'running', 'completed'];
const ORG = { name: 'Salle Nord', slug: 'nord', logo_url: null, brand_color: null };
const event = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  status,
  event_kind: 'standard',
  organization_id: 'org-a',
  start_date: '2026-06-01',
  end_date: '2026-06-02',
  organizations: ORG,
  ...extra,
});
const league = (
  tournamentId: string,
  id: string,
  shown: Record<string, unknown> = { status: 'published', public_visibility: true },
) => ({
  tournament_id: tournamentId,
  status: 'approved',
  leagues: { id, name: id, slug: id, ...shown },
});
const HIDDEN_LEAGUES = [
  league('t-open', 'draft-league', { status: 'draft', public_visibility: true }),
  league('t-open', 'private-league', { status: 'published', public_visibility: false }),
  league('t-done', 'archived-league', { status: 'archived', public_visibility: true }),
  league('t-done', 'league-read-bare', {}),
  league('t-done', 'visibility-read-bare', { status: 'published' }),
  // A public League, but the link was never approved.
  { ...league('t-open', 'requested-league'), status: 'requested' },
];

let db: ReturnType<typeof mockSupabase>;
let service: EventsService;

function seed(tables: Partial<Record<string, TableSeed>> = {}) {
  db = mockSupabase({
    events: {
      rows: [
        event('e-open', 'published'),
        event('e-draft', 'draft'),
        event('e-test', 'published', { event_kind: 'test' }),
      ],
    },
    tournaments: {
      rows: [
        { id: 't-open', event_id: 'e-open', status: 'published' },
        { id: 't-done', event_id: 'e-open', status: 'completed' },
        { id: 't-secret', event_id: 'e-open', status: 'draft' },
        { id: 't-draft-event', event_id: 'e-draft', status: 'published' },
      ],
    },
    league_tournament_links: {
      rows: [league('t-open', 'french-cup'), league('t-secret', 'secret-league')],
    },
    weapon_catalog: { rows: [{ slug: 'sabre', name: 'Sabre' }] },
    ...tables,
  } as Record<string, TableSeed>);
  service = new EventsService(db as never, {} as never, {} as never, {} as never);
}

type Listed = { id: string; tournament_count: number; leagues: Array<{ id: string }> };
const list = async (query: Record<string, string> = {}) =>
  (await service.listEvents(query)) as unknown as Listed[];

beforeEach(() => seed());

describe('GET /events — the directory shows public things only, for everyone (rulings 129, 163)', () => {
  it('counts and tags an Event by its public Tournaments only, reading only those', async () => {
    const [open, ...rest] = await list();
    expect(rest).toEqual([]);
    expect(open?.id).toBe('e-open');
    expect(open?.tournament_count).toBe(2);
    expect(open?.leagues.map((l) => l.id)).toEqual(['french-cup']);
    expect(selectsFor(db.from, 'tournaments')).toEqual(['id, event_id']);
    expect(filtersFor(db.from, 'tournaments', 'in')).toEqual([
      ['event_id', ['e-open']],
      ['status', PUBLIC],
    ]);
  });

  it('tags no draft or private league, answering it as no link (ruling 88)', async () => {
    const LINKS = [league('t-open', 'french-cup'), league('t-secret', 'secret-league')];
    seed({ league_tournament_links: { rows: [...LINKS, ...HIDDEN_LEAGUES] } });
    const withHidden = await list();
    expect(withHidden[0]?.leagues).toEqual([
      { id: 'french-cup', name: 'french-cup', slug: 'french-cup' },
    ]);
    seed({ league_tournament_links: { rows: LINKS } });
    expect(withHidden).toEqual(await list());
    expect(selectsFor(db.from, 'league_tournament_links')).toEqual([
      'tournament_id, leagues(id, name, slug, status, public_visibility)',
    ]);
  });

  it.each(['draft', 'no-such-status'])(
    'lists no Event for ?status=%s, as for a status no Event has',
    async (status) => {
      expect(await list({ status })).toEqual([]);
      expect(filtersFor(db.from, 'events', 'neq')).toContainEqual(['status', 'draft']);
    },
  );

  it('keeps the public filters: ?status=all and no status list the public statuses', async () => {
    const queries: Array<Record<string, string>> = [{}, { status: 'all' }];
    for (const query of queries) {
      seed();
      expect((await list(query)).map((e) => e.id)).toEqual(['e-open']);
      expect(filtersFor(db.from, 'events', 'in')).toEqual([['status', PUBLIC]]);
    }
  });

  it('filters by weapon through public Tournaments only', async () => {
    // The seeded double narrows on flat keys: this Event's only Sabre Tournament is a draft.
    seed({
      events: {
        rows: [
          event('e-open', 'published', {
            'tournaments.weapon': 'Sabre',
            'tournaments.status': 'draft',
          }),
        ],
      },
    });
    expect(await list({ weapon: 'sabre' })).toEqual([]);
    expect(selectsFor(db.from, 'events')).toEqual([
      '*, organizations(name, slug, logo_url, brand_color), tournaments!inner(weapon, status)',
    ]);
    expect(filtersFor(db.from, 'events', 'eq')).toContainEqual(['tournaments.weapon', 'Sabre']);
    expect(filtersFor(db.from, 'events', 'in')).toContainEqual(['tournaments.status', PUBLIC]);
  });

  it.each(['events', 'tournaments', 'league_tournament_links'])(
    'fails a failed %s read as a 5xx, never as "no Event"',
    async (table) => {
      seed({ [table]: { data: null, error: { message: 'connection reset' } } });
      const failure = await list().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(HttpException);
    },
  );
});
