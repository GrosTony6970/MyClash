import { describe, expect, it } from 'vitest';
import { filtersFor, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { expectNoRawIds } from '../mcp/tools/no-raw-ids.test-helper';
import { readableDraftActions } from './readable-draft';
import {
  EVENT,
  LONGSWORD,
  FOREIGN_TOURNAMENT,
  MATCH,
  FOREIGN_MATCH,
  LICE,
  POOL,
  FOREIGN_POOL,
  FOREIGN_PHASE,
  PHASE,
  PERSON,
  SKILL,
  FOREIGN_SKILL,
  GONE,
  seeded,
  TOURNAMENT_DRAFT,
  POOLS_DRAFT,
  BRACKET_DRAFT,
  SCHEDULE_DRAFT,
  REFEREE_DRAFT,
  LSW_P2_M4,
  MISSING,
} from './readable-draft.fixtures';

/**
 * Call U (MCP slice 4b). Marie opens a draft and reads it in names: "Longsword Open",
 * "LSW-P2-M4", "Piste 2", "Paul Martin", "Déclarant". An id the Event no longer has reads as
 * missing, and another Event's row never lends its name.
 */

describe('readableDraftActions', () => {
  it('names each kind of action, with one read per kind of id across the drafts', async () => {
    const db = seeded();

    const readable = await readableDraftActions(db.service as never, EVENT, [
      TOURNAMENT_DRAFT,
      POOLS_DRAFT,
      BRACKET_DRAFT,
      SCHEDULE_DRAFT,
      REFEREE_DRAFT,
    ]);

    expect(readable).toEqual([
      [{ kind: 'create_tournament', name: 'Sabre Open', slug: 'sabre-open', weapon: 'sabre' }],
      [
        {
          kind: 'generate_pools',
          tournament: { name: 'Longsword Open' },
          poolCount: 4,
          schoolSeparation: true,
          skillBalance: false,
        },
      ],
      [
        {
          kind: 'generate_bracket',
          tournament: { name: 'Longsword Open' },
          phaseType: 'single_elim',
          qualifyCount: 16,
          poolPhase: { type: 'pool', tournament: 'Longsword Open' },
        },
      ],
      [
        {
          kind: 'schedule_match',
          match: LSW_P2_M4,
          piste: { name: 'Piste 2' },
          startsAt: '2026-12-05T13:30:00.000Z',
          timezone: 'Europe/Paris',
        },
      ],
      [
        {
          kind: 'assign_referee',
          referee: { name: 'Paul Martin' },
          role: { name: 'Déclarant' },
          pool: { number: 2, tournament: 'Longsword Open' },
        },
        {
          kind: 'assign_referee',
          referee: { name: 'Paul Martin' },
          role: { name: 'Déclarant' },
          match: LSW_P2_M4,
        },
      ],
    ]);
    expectNoRawIds(readable);
    expect([...queriedTables(db.from)].sort()).toEqual([
      'event_referees',
      'events',
      'lices',
      'matches',
      'phases',
      'pools',
      'referee_skills',
      'tournaments',
    ]);
  });

  it('asks each read for its columns, scoped to the Event', async () => {
    const db = seeded();

    await readableDraftActions(db.service as never, EVENT, [
      POOLS_DRAFT,
      BRACKET_DRAFT,
      SCHEDULE_DRAFT,
      REFEREE_DRAFT,
    ]);

    const select = (table: string) => selectsFor(db.from, table);
    const filters = (table: string, method: 'eq' | 'in' | 'or') =>
      filtersFor(db.from, table, method);
    expect(select('tournaments')).toEqual(['id, name']);
    expect(filters('tournaments', 'eq')).toEqual([['event_id', EVENT]]);
    expect(filters('tournaments', 'in')).toEqual([['id', [LONGSWORD]]]);
    expect(select('matches')).toEqual([
      'id, match_number_label, phases(config_json,tournaments(weapon,name,event_id)),pools(sort_order),bracket_slots(round),swiss_rounds(round_number)',
    ]);
    expect(filters('matches', 'in')).toEqual([['id', [MATCH]]]);
    expect(select('lices')).toEqual(['id, name']);
    expect(filters('lices', 'eq')).toEqual([['event_id', EVENT]]);
    expect(filters('lices', 'in')).toEqual([['id', [LICE]]]);
    expect(select('pools')).toEqual(['id, sort_order, phases(tournaments(name, event_id))']);
    expect(filters('pools', 'in')).toEqual([['id', [POOL]]]);
    expect(select('phases')).toEqual(['id, type, tournaments(name, event_id)']);
    expect(filters('phases', 'in')).toEqual([['id', [PHASE]]]);
    expect(select('event_referees')).toEqual([
      'person_id, global_persons(given_name, family_name, display_name)',
    ]);
    expect(filters('event_referees', 'eq')).toEqual([['event_id', EVENT]]);
    expect(filters('event_referees', 'in')).toEqual([['person_id', [PERSON]]]);
    expect(select('referee_skills')).toEqual(['id, name, event_id']);
    expect(filters('referee_skills', 'or')).toEqual([[`event_id.is.null,event_id.eq.${EVENT}`]]);
    expect(select('events')).toEqual(['timezone']);
    expect(filters('events', 'eq')).toEqual([['id', EVENT]]);
  });

  it("reads another Event's Tournament, Match, Pool, phase and role as missing", async () => {
    const readable = await readableDraftActions(seeded().service as never, EVENT, [
      [{ kind: 'generate_pools', tournamentId: FOREIGN_TOURNAMENT, poolCount: 2 }],
      [{ kind: 'schedule_match', matchId: FOREIGN_MATCH, liceId: LICE, scheduledAt: 'x' }],
      [{ kind: 'assign_referee', userId: PERSON, role: FOREIGN_SKILL, matchId: FOREIGN_MATCH }],
      [{ kind: 'assign_referee', userId: PERSON, role: SKILL, poolId: FOREIGN_POOL }],
      [{ kind: 'generate_bracket', tournamentId: LONGSWORD, poolPhaseId: FOREIGN_PHASE }],
    ]);

    expect(readable).toEqual([
      [{ kind: 'generate_pools', tournament: MISSING, poolCount: 2 }],
      [
        {
          kind: 'schedule_match',
          match: MISSING,
          piste: { name: 'Piste 2' },
          startsAt: null,
          timezone: 'Europe/Paris',
        },
      ],
      [
        {
          kind: 'assign_referee',
          referee: { name: 'Paul Martin' },
          role: MISSING,
          match: MISSING,
        },
      ],
      [
        {
          kind: 'assign_referee',
          referee: { name: 'Paul Martin' },
          role: { name: 'Déclarant' },
          pool: MISSING,
        },
      ],
      [{ kind: 'generate_bracket', tournament: { name: 'Longsword Open' }, poolPhase: MISSING }],
    ]);
  });

  it('reads a Match, piste, Pool, phase, referee and role deleted since as missing', async () => {
    const readable = await readableDraftActions(seeded().service as never, EVENT, [
      [{ kind: 'generate_bracket', tournamentId: LONGSWORD, poolPhaseId: GONE }],
      [{ kind: 'schedule_match', matchId: GONE, liceId: GONE, scheduledAt: '2026-12-05T13:30Z' }],
      [{ kind: 'assign_referee', userId: GONE, role: GONE, poolId: GONE }],
    ]);

    expect(readable).toEqual([
      [{ kind: 'generate_bracket', tournament: { name: 'Longsword Open' }, poolPhase: MISSING }],
      [
        {
          kind: 'schedule_match',
          match: MISSING,
          piste: MISSING,
          startsAt: '2026-12-05T13:30:00.000Z',
          timezone: 'Europe/Paris',
        },
      ],
      [{ kind: 'assign_referee', referee: MISSING, role: MISSING, pool: MISSING }],
    ]);
    expectNoRawIds(readable);
  });

  it('answers an action of no known kind as unsupported, without echoing it', async () => {
    const db = seeded();

    const readable = await readableDraftActions(db.service as never, EVENT, [
      [{ kind: 'constructor' }, { kind: GONE, tournamentId: LONGSWORD }, null, 'set_pools'],
      'not a list',
    ]);

    expect(readable).toEqual([
      [
        { kind: 'unsupported' },
        { kind: 'unsupported' },
        { kind: 'unsupported' },
        { kind: 'unsupported' },
      ],
      [],
    ]);
    expect(queriedTables(db.from)).toEqual([]);
  });

  it('reads an id that is no uuid as missing, and never sends it to a uuid column', async () => {
    // The chat's model passed the round code and the names it read, not the ids. Sent in an
    // `.in()` list, one of them made Postgres refuse the whole read (22P02): the list, the draft
    // and the chat answered 500, and the page that could reject the draft could not show it.
    const db = seeded();

    const readable = await readableDraftActions(db.service as never, EVENT, [
      [{ kind: 'schedule_match', matchId: 'LSW-P2-M04', liceId: 'Piste 2', scheduledAt: 'x' }],
      [{ kind: 'assign_referee', userId: 'Paul Martin', role: SKILL, poolId: 'P2' }],
      [{ kind: 'generate_bracket', tournamentId: 'longsword-open', poolPhaseId: 'pools' }],
      [{ kind: 'generate_pools', tournamentId: 42, poolCount: 4 }],
    ]);

    expect(readable).toEqual([
      [
        {
          kind: 'schedule_match',
          match: MISSING,
          piste: MISSING,
          startsAt: null,
          timezone: 'Europe/Paris',
        },
      ],
      [{ kind: 'assign_referee', referee: MISSING, role: { name: 'Déclarant' }, pool: MISSING }],
      [{ kind: 'generate_bracket', tournament: MISSING, poolPhase: MISSING }],
      [{ kind: 'generate_pools', tournament: MISSING, poolCount: 4 }],
    ]);
    const tables = ['tournaments', 'matches', 'lices', 'pools', 'phases', 'event_referees'];
    expect(tables.flatMap((table) => filtersFor(db.from, table, 'in'))).toEqual([]);
  });

  it("leaves out a uuid the model wrote in a new Tournament's text", async () => {
    const readable = await readableDraftActions(seeded().service as never, EVENT, [
      [
        {
          kind: 'create_tournament',
          name: LONGSWORD,
          slug: GONE,
          weapon: PHASE,
          rulesetCode: POOL,
        },
      ],
      [{ kind: 'create_tournament', name: 'Sabre Open', slug: 'sabre-open', rulesetCode: LICE }],
    ]);

    expect(readable).toEqual([
      [{ kind: 'create_tournament' }],
      [{ kind: 'create_tournament', name: 'Sabre Open', slug: 'sabre-open' }],
    ]);
    expectNoRawIds(readable);
  });

  it('throws on a failed read rather than read the name as missing', async () => {
    const db = seeded({ tournaments: { data: null, error: { message: 'connection reset' } } });

    await expect(readableDraftActions(db.service as never, EVENT, [POOLS_DRAFT])).rejects.toThrow(
      'draft Tournaments read failed: connection reset',
    );
  });
});
