/**
 * The public league pages name no hidden Tournament (ruling 163): a page spanning many Events
 * shows only published, running or completed Tournaments of a public Event, the same for
 * everyone. Until 2026-09-30 an approved link to a draft Tournament, or to any Tournament of a
 * draft or test Event, put its name, its Event's name and its date on the public standings
 * (`columns`, `pendingTournaments`), counted it on the public league list, and listed its Event
 * among the league's Events. A hidden link now answers exactly as no link does. The routes read
 * no caller, so no one sees more on them. The league admin's own standings still list every
 * approved link, as its links list does.
 *
 * Driven through the controller and the real service over seeded tables.
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { LeaguesController } from './leagues.controller';
import { LeaguesService } from './leagues.service';

const LEAGUE = '11111111-1111-4111-8111-111111111111';

function link(id: string, status: string | undefined, eventStatus: string, eventKind = 'standard') {
  return {
    league_id: LEAGUE,
    status: 'approved',
    group_id: 'g-open',
    tournament_id: id,
    tournaments: {
      id,
      name: `Tournament ${id}`,
      event_id: `event-${id}`,
      status,
      events: {
        id: `event-${id}`,
        name: `Event ${id}`,
        slug: `slug-${id}`,
        start_date: '2026-10-01',
        end_date: null,
        status: eventStatus,
        event_kind: eventKind,
        organizations: { id: 'org-a', name: 'Club A' },
      },
    },
    league_groups: { name: 'Open' },
  };
}

type Link = ReturnType<typeof link>;

const SHOWN = [
  link('open', 'published', 'published'),
  link('running', 'running', 'running'),
  // An archived Event stays public (`isPublicEvent`).
  link('old', 'completed', 'archived'),
];
const HIDDEN = [
  link('draft-t', 'draft', 'published'),
  link('draft-e', 'published', 'draft'),
  link('test-e', 'published', 'published', 'test'),
  link('no-status', undefined, 'published'),
];

function build(links: Link[], linksRead?: { data: null; error: { message: string } }) {
  const db = mockSupabase({
    leagues: {
      rows: [
        {
          id: LEAGUE,
          slug: 'cup',
          status: 'published',
          public_visibility: true,
          season_year: 2026,
          scoring_config: {},
        },
      ],
    },
    league_groups: { rows: [{ id: 'g-open', league_id: LEAGUE, name: 'Open', sort_order: 0 }] },
    league_tournament_links: linksRead ?? { rows: links },
    // Only `open` has contributed results: `running` and `old` are still pending.
    league_tournament_results: { rows: [{ league_id: LEAGUE, tournament_id: 'open' }] },
    league_rankings: { rows: [] },
    platform_roles: { rows: [{ user_id: 'u-padmin', role: 'platform_admin' }] },
  });
  const supabase = { service: db.service };
  const service = new LeaguesService(supabase as never, {} as never, {} as never);
  return { db, service, controller: new LeaguesController(service, supabase as never) };
}

const standings = (links: Link[]) => build(links).controller.standings(LEAGUE, {});
const columnIds = (payload: { columns: Array<Record<string, unknown>> }) =>
  payload.columns.map((column) => column['tournament_id']);

describe('the public league standings (ruling 163)', () => {
  it('names only public Tournaments in columns and pendingTournaments', async () => {
    const payload = await standings([...SHOWN, ...HIDDEN]);
    expect(columnIds(payload)).toEqual(['open', 'running', 'old']);
    expect(payload.pendingTournaments).toEqual([
      { tournamentId: 'running', name: 'Tournament running', eventName: 'Event running' },
      { tournamentId: 'old', name: 'Tournament old', eventName: 'Event old' },
    ]);
  });

  it('answers a hidden link exactly as no link', async () => {
    expect(await standings([...SHOWN, ...HIDDEN])).toEqual(await standings(SHOWN));
  });

  it("reads each linked Tournament's status and its Event's status and kind", async () => {
    const { db, controller } = build(SHOWN);
    await controller.standings(LEAGUE, {});
    expect(selectsFor(db.from, 'league_tournament_links')).toEqual([
      'tournament_id, tournaments(id, name, event_id, status, events(name, start_date, status, event_kind)), league_groups(name)',
    ]);
  });

  it('fails a failed links read loudly, never as a league with no Tournaments', async () => {
    const { controller } = build([], { data: null, error: { message: 'connection reset' } });
    const read = controller.standings(LEAGUE, {});
    await expect(read).rejects.toThrow(/^league links read failed: connection reset$/);
    await expect(read).rejects.not.toBeInstanceOf(HttpException);
  });

  it("keeps every approved link on the league admin's own standings", async () => {
    const payload = await build([...SHOWN, ...HIDDEN]).service.adminStandings(LEAGUE, 'u-padmin');
    expect(columnIds(payload)).toEqual([
      'open',
      'running',
      'old',
      'draft-t',
      'draft-e',
      'test-e',
      'no-status',
    ]);
  });
});

describe('the public league list (ruling 163)', () => {
  const list = async (links: Link[]) =>
    (await build(links).controller.listPublic()) as Array<Record<string, unknown>>;

  it('counts only public Tournaments and their Events', async () => {
    expect((await list([...SHOWN, ...HIDDEN]))[0]).toMatchObject({
      event_count: 3,
      tournament_count: 3,
      groups: [{ id: 'g-open', name: 'Open', tournament_count: 3 }],
    });
  });

  it('answers a hidden link exactly as no link', async () => {
    expect(await list([...SHOWN, ...HIDDEN])).toEqual(await list(SHOWN));
  });

  it("reads each linked Tournament's status and its Event's status and kind", async () => {
    const { db, controller } = build(SHOWN);
    await controller.listPublic();
    expect(selectsFor(db.from, 'league_tournament_links')).toEqual([
      'league_id, group_id, tournaments(event_id, status, events(status, event_kind))',
    ]);
  });

  it('fails a failed links read loudly, never as a league with no Tournaments', async () => {
    const { controller } = build([], { data: null, error: { message: 'connection reset' } });
    const read = controller.listPublic();
    await expect(read).rejects.toThrow(/^league links read failed: connection reset$/);
    await expect(read).rejects.not.toBeInstanceOf(HttpException);
  });
});

describe("the league's public Events (rulings 88, 163)", () => {
  const events = async (links: Link[]) =>
    (await build(links).controller.listLeagueMemberEvents(LEAGUE)).map((event) => event.id);

  it('lists no Event reached only through a hidden Tournament', async () => {
    expect(await events([...SHOWN, ...HIDDEN])).toEqual([
      'event-open',
      'event-running',
      'event-old',
    ]);
  });

  it('answers a hidden link exactly as no link', async () => {
    expect(await events([...SHOWN, ...HIDDEN])).toEqual(await events(SHOWN));
  });

  it('lists a public Event once when it also holds a hidden Tournament', async () => {
    const draftBeside = link('draft-beside', 'draft', 'published');
    draftBeside.tournaments.event_id = 'event-open';
    draftBeside.tournaments.events = { ...draftBeside.tournaments.events, id: 'event-open' };
    expect(await events([draftBeside, ...SHOWN])).toEqual([
      'event-open',
      'event-running',
      'event-old',
    ]);
  });

  it("reads each linked Tournament's status and its Event's status and kind", async () => {
    const { db, controller } = build(SHOWN);
    await controller.listLeagueMemberEvents(LEAGUE);
    expect(selectsFor(db.from, 'league_tournament_links')).toEqual([
      'status, tournaments!inner(event_id, status, events(id, name, slug, start_date, end_date, status, event_kind, organizations(id, name)))',
    ]);
  });
});
