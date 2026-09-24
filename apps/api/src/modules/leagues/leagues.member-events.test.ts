/**
 * `GET leagues/:leagueId/member-events` — the public "other events in this
 * league" list (ruling 88).
 *
 * Until 2026-09-24 it answered any league id with every Event that has an
 * approved Tournament link, a draft or private league's included, and a DRAFT
 * Event's included. Now a league the public league pages do not show (not
 * published, or not publicly visible) answers exactly as an unknown league
 * does, with an empty list, and a draft Event is left out of a public league's
 * list. Its one caller, the public league page, reaches it only through the
 * gated league-by-slug read, so no insider path is needed.
 *
 * Driven through the controller and the real service over seeded tables.
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { LeaguesController } from './leagues.controller';
import { LeaguesService } from './leagues.service';

const PUBLIC = '11111111-1111-4111-8111-111111111111';
const DRAFT = '22222222-2222-4222-8222-222222222222';
const PRIVATE = '33333333-3333-4333-8333-333333333333';
const NOBODY = '99999999-9999-4999-8999-999999999999';

const event = (id: string, status: string) => ({
  id,
  name: `Event ${id}`,
  slug: `slug-${id}`,
  start_date: '2026-10-01',
  end_date: null,
  status,
  organizations: { id: 'org-a', name: 'Club A' },
});
const link = (leagueId: string, eventRow: ReturnType<typeof event>, status = 'approved') => ({
  league_id: leagueId,
  status,
  tournaments: { event_id: eventRow.id, events: eventRow },
});

const OPEN = event('open', 'published');
const RUNNING = event('running', 'running');
const DRAFT_EVENT = event('draft', 'draft');
const PENDING = event('pending', 'published');

let db: ReturnType<typeof mockSupabase>;
let controller: LeaguesController;

function build(leagues: Parameters<typeof mockSupabase>[0][string]) {
  db = mockSupabase({
    leagues,
    league_tournament_links: {
      rows: [
        link(PUBLIC, OPEN),
        link(PUBLIC, DRAFT_EVENT),
        link(PUBLIC, RUNNING),
        link(PUBLIC, PENDING, 'pending'),
        link(DRAFT, OPEN),
        link(PRIVATE, OPEN),
      ],
    },
  });
  const supabase = { service: db.service };
  controller = new LeaguesController(
    new LeaguesService(supabase as never, {} as never, {} as never),
    supabase as never,
  );
}

beforeEach(() =>
  build({
    rows: [
      { id: PUBLIC, status: 'published', public_visibility: true },
      { id: DRAFT, status: 'draft', public_visibility: true },
      { id: PRIVATE, status: 'published', public_visibility: false },
    ],
  }),
);

const ids = (events: Array<{ id: string }>) => events.map((e) => e.id);

describe('GET leagues/:leagueId/member-events (ruling 88)', () => {
  it("lists a public league's approved Events, and leaves a draft Event out", async () => {
    expect(ids(await controller.listLeagueMemberEvents(PUBLIC))).toEqual(['open', 'running']);
  });

  it('answers a draft or private league exactly as an unknown one, before reading its links', async () => {
    expect(await controller.listLeagueMemberEvents(NOBODY)).toEqual([]);
    expect(await controller.listLeagueMemberEvents(DRAFT)).toEqual([]);
    expect(await controller.listLeagueMemberEvents(PRIVATE)).toEqual([]);
    expect(queriedTables(db.from)).not.toContain('league_tournament_links');
  });

  it("reads the league's status and visibility, and each Event's status", async () => {
    await controller.listLeagueMemberEvents(PUBLIC);
    expect(selectsFor(db.from, 'leagues')).toEqual(['status, public_visibility']);
    expect(selectsFor(db.from, 'league_tournament_links')).toEqual([
      'status, tournaments!inner(event_id, events(id, name, slug, start_date, end_date, status, event_kind, organizations(id, name)))',
    ]);
  });

  it('fails a failed links read loudly, with no database words in a 400', async () => {
    db = mockSupabase({
      leagues: { rows: [{ id: PUBLIC, status: 'published', public_visibility: true }] },
      league_tournament_links: { data: null, error: { message: 'connection reset' } },
    });
    const supabase = { service: db.service };
    controller = new LeaguesController(
      new LeaguesService(supabase as never, {} as never, {} as never),
      supabase as never,
    );
    await expect(controller.listLeagueMemberEvents(PUBLIC)).rejects.toThrow(
      /^league links read failed: connection reset$/,
    );
    await expect(controller.listLeagueMemberEvents(PUBLIC)).rejects.not.toBeInstanceOf(
      HttpException,
    );
  });

  it('fails a failed league read loudly, never as an unknown league', async () => {
    build({ data: null, error: { message: 'connection reset' } });
    await expect(controller.listLeagueMemberEvents(PUBLIC)).rejects.toThrow(
      /^league read failed: connection reset$/,
    );
    await expect(controller.listLeagueMemberEvents(PUBLIC)).rejects.not.toBeInstanceOf(
      HttpException,
    );
  });
});
