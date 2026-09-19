import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { PROGRAMME_CONFIG_DEFAULTS } from '../programme/dto/programme.dto';
import { embeddedOne, resolveMatchLengths, resolveMatchWindows } from './match-lengths';

/**
 * The seeded double, not canned rows: every read here filters, and the point of
 * the helper is which rows it narrows to. The SELECT strings are asserted too —
 * the double ignores the projection, so a column deleted from a read leaves the
 * values right and the query wrong.
 */

const EVENT = 'event-1';
// The stored sheet's schema demands a UUID per Tournament row.
const LONGSWORD = '11111111-1111-4111-8111-111111111111';
const SABRE = '22222222-2222-4222-8222-222222222222';

/** The Event's sheet as the planner stores it: defaults unless a test says otherwise. */
function sheetRow(over: Record<string, unknown> = {}) {
  return [{ event_id: EVENT, config_json: { ...PROGRAMME_CONFIG_DEFAULTS, ...over } }];
}

function db(tables: Record<string, unknown>) {
  const supabase = mockSupabase(tables as Parameters<typeof mockSupabase>[0]);
  return { client: supabase.service as unknown as SupabaseClient, supabase };
}

/** A phase row as `phases` stores it. */
function phase(id: string, type: string, tournamentId = LONGSWORD) {
  return { id, type, tournament_id: tournamentId };
}

/** A bracket Match with its slot's round embedded, as PostgREST projects it. */
function bracketMatch(id: string, phaseId: string, round: number | null) {
  return { id, phase_id: phaseId, bracket_slot_id: `slot-${id}`, bracket_slots: { round } };
}

describe('embeddedOne', () => {
  // PostgREST hands a to-one embed over as an object or as a one-element array,
  // for the same query. A reader that knows only one shape gets `undefined` for
  // the other and, if it then falls back to a default, is wrong in silence.
  it('reads the object shape', () => {
    expect(embeddedOne({ tournament_id: 't1' })).toEqual({ tournament_id: 't1' });
  });

  it('reads the one-element array shape', () => {
    expect(embeddedOne([{ tournament_id: 't1' }])).toEqual({ tournament_id: 't1' });
  });

  it('reads nothing as null, whichever way it arrives', () => {
    expect(embeddedOne(null)).toBeNull();
    expect(embeddedOne(undefined)).toBeNull();
    expect(embeddedOne([])).toBeNull();
  });

  it('keeps a falsy embedded value rather than calling it nothing', () => {
    // `[0]` on an array of one 0 is falsy; only a nullish check may answer null.
    expect(embeddedOne([0])).toBe(0);
  });
});

describe('resolveMatchLengths', () => {
  it('reads nothing at all for an empty batch', async () => {
    const { client, supabase } = db({});

    expect(await resolveMatchLengths(client, EVENT, [])).toEqual(new Map());
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('gives a pool bout the sheet pool length and asks for the columns it reads', async () => {
    const { client, supabase } = db({
      event_programme_configs: { rows: sheetRow() },
      phases: { rows: [phase('p1', 'pool')] },
    });

    const lengths = await resolveMatchLengths(client, EVENT, [
      { id: 'm1', phaseId: 'p1', plannedDurationOverrideMinutes: null },
    ]);

    expect(lengths.get('m1')).toBe(5);
    expect(selectsFor(supabase.from, 'event_programme_configs')).toEqual(['config_json']);
    expect(selectsFor(supabase.from, 'phases')).toEqual(['id, type, tournament_id']);
    expect(filtersFor(supabase.from, 'phases', 'in')).toEqual([['id', ['p1']]]);
  });

  it('reads no sheet when the caller hands it one, and measures by that one', async () => {
    const { client, supabase } = db({
      event_programme_configs: { rows: sheetRow() },
      phases: { rows: [phase('p1', 'pool')] },
    });
    const sheet = { ...PROGRAMME_CONFIG_DEFAULTS, poolMatchDurationMinutes: 7 };

    const lengths = await resolveMatchLengths(
      client,
      EVENT,
      [{ id: 'm1', phaseId: 'p1', plannedDurationOverrideMinutes: null }],
      sheet,
    );

    expect(lengths.get('m1')).toBe(7);
    expect(selectsFor(supabase.from, 'event_programme_configs')).toEqual([]);
  });

  it('never reads matches when no phase in the batch is a bracket', async () => {
    const { client, supabase } = db({
      event_programme_configs: { rows: sheetRow() },
      phases: { rows: [phase('p1', 'pool'), phase('p2', 'swiss')] },
    });

    await resolveMatchLengths(client, EVENT, [
      { id: 'm1', phaseId: 'p1', plannedDurationOverrideMinutes: null },
      { id: 'm2', phaseId: 'p2', plannedDurationOverrideMinutes: null },
    ]);

    expect(selectsFor(supabase.from, 'matches')).toEqual([]);
  });

  it('falls a Swiss bout back to the pool length when no Swiss length is typed', async () => {
    const { client } = db({
      event_programme_configs: { rows: sheetRow({ poolMatchDurationMinutes: 6 }) },
      phases: { rows: [phase('p1', 'swiss')] },
    });

    const lengths = await resolveMatchLengths(client, EVENT, [
      { id: 'm1', phaseId: 'p1', plannedDurationOverrideMinutes: null },
    ]);

    expect(lengths.get('m1')).toBe(6);
  });

  it("reads a Tournament's own length before the Event's", async () => {
    const { client } = db({
      event_programme_configs: {
        rows: sheetRow({
          tournaments: [{ tournamentId: SABRE, poolMatchDurationMinutes: 11 }],
        }),
      },
      phases: { rows: [phase('p1', 'pool', SABRE), phase('p2', 'pool', LONGSWORD)] },
    });

    const lengths = await resolveMatchLengths(client, EVENT, [
      { id: 'm1', phaseId: 'p1', plannedDurationOverrideMinutes: null },
      { id: 'm2', phaseId: 'p2', plannedDurationOverrideMinutes: null },
    ]);

    expect(lengths.get('m1')).toBe(11);
    expect(lengths.get('m2')).toBe(5);
  });

  it("lets a Match's own number beat the sheet", async () => {
    const { client, supabase } = db({
      event_programme_configs: { rows: sheetRow() },
      phases: { rows: [phase('p1', 'pool')] },
    });

    const lengths = await resolveMatchLengths(client, EVENT, [
      { id: 'm1', phaseId: 'p1', plannedDurationOverrideMinutes: 17 },
    ]);

    expect(lengths.get('m1')).toBe(17);
    // Still read: a batch mixes overridden and plain Matches, and the phase read
    // is what proves the Match exists in a phase at all.
    expect(selectsFor(supabase.from, 'phases')).toHaveLength(1);
  });

  it('gives the bracket final round the finals length and the rest elimination', async () => {
    const { client, supabase } = db({
      event_programme_configs: { rows: sheetRow() },
      phases: { rows: [phase('p1', 'single_elim')] },
      matches: {
        rows: [
          bracketMatch('semi-a', 'p1', 1),
          bracketMatch('semi-b', 'p1', 1),
          bracketMatch('final', 'p1', 2),
        ],
      },
    });

    const lengths = await resolveMatchLengths(client, EVENT, [
      { id: 'semi-a', phaseId: 'p1', plannedDurationOverrideMinutes: null },
      { id: 'final', phaseId: 'p1', plannedDurationOverrideMinutes: null },
    ]);

    expect(lengths.get('semi-a')).toBe(8);
    expect(lengths.get('final')).toBe(10);
    expect(selectsFor(supabase.from, 'matches')).toEqual(['id, phase_id, bracket_slots(round)']);
    expect(filtersFor(supabase.from, 'matches', 'in')).toEqual([['phase_id', ['p1']]]);
    expect(filtersFor(supabase.from, 'matches', 'not')).toEqual([['bracket_slot_id', 'is', null]]);
  });

  it('counts a final round per PHASE, not per Tournament', async () => {
    // A main draw and a repechage in one Tournament number their rounds
    // independently. One number over the pair would call the repechage final an
    // ordinary elimination bout.
    const { client } = db({
      event_programme_configs: { rows: sheetRow() },
      phases: { rows: [phase('main', 'single_elim'), phase('repechage', 'single_elim')] },
      matches: {
        rows: [
          bracketMatch('main-semi', 'main', 4),
          bracketMatch('main-final', 'main', 5),
          bracketMatch('rep-final', 'repechage', 2),
        ],
      },
    });

    const lengths = await resolveMatchLengths(client, EVENT, [
      { id: 'main-semi', phaseId: 'main', plannedDurationOverrideMinutes: null },
      { id: 'main-final', phaseId: 'main', plannedDurationOverrideMinutes: null },
      { id: 'rep-final', phaseId: 'repechage', plannedDurationOverrideMinutes: null },
    ]);

    expect(lengths.get('main-semi')).toBe(8);
    expect(lengths.get('main-final')).toBe(10);
    expect(lengths.get('rep-final')).toBe(10);
  });

  it('leaves the grand final as the final round when a reset slot has no Match', async () => {
    // Double elimination generates the reset one round past the grand final and
    // creates no Match for it until it is needed. Counting slots would push the
    // final round past the grand final and cost it its finals length.
    const { client } = db({
      event_programme_configs: { rows: sheetRow() },
      phases: { rows: [phase('p1', 'double_elim')] },
      matches: { rows: [bracketMatch('grand-final', 'p1', 6)] },
    });

    const lengths = await resolveMatchLengths(client, EVENT, [
      { id: 'grand-final', phaseId: 'p1', plannedDurationOverrideMinutes: null },
    ]);

    expect(lengths.get('grand-final')).toBe(10);
  });

  it('treats a bracket Match whose round does not resolve as elimination', async () => {
    const { client } = db({
      event_programme_configs: { rows: sheetRow() },
      phases: { rows: [phase('p1', 'single_elim')] },
      matches: { rows: [bracketMatch('placed', 'p1', 3)] },
    });

    const lengths = await resolveMatchLengths(client, EVENT, [
      // Not among the slotted Matches: it has no bracket slot of its own.
      { id: 'unslotted', phaseId: 'p1', plannedDurationOverrideMinutes: null },
    ]);

    expect(lengths.get('unslotted')).toBe(8);
  });

  it('reads an embedded slot projected as an array', async () => {
    // PostgREST projects a one-to-one embed as an object or as a one-element
    // array depending on the cardinality it infers; both reach the helper.
    const { client } = db({
      event_programme_configs: { rows: sheetRow() },
      phases: { rows: [phase('p1', 'single_elim')] },
      matches: {
        rows: [
          { id: 'final', phase_id: 'p1', bracket_slot_id: 's', bracket_slots: [{ round: 2 }] },
        ],
      },
    });

    const lengths = await resolveMatchLengths(client, EVENT, [
      { id: 'final', phaseId: 'p1', plannedDurationOverrideMinutes: null },
    ]);

    expect(lengths.get('final')).toBe(10);
  });

  it('refuses a Match whose phase does not exist', async () => {
    const { client } = db({
      event_programme_configs: { rows: sheetRow() },
      phases: { rows: [phase('p1', 'pool')] },
    });

    await expect(
      resolveMatchLengths(client, EVENT, [
        { id: 'm1', phaseId: 'ghost', plannedDurationOverrideMinutes: null },
      ]),
    ).rejects.toThrow('Match phase ghost does not exist');
  });

  it('refuses a failed phase read rather than inventing a length', async () => {
    const { client } = db({
      event_programme_configs: { rows: sheetRow() },
      phases: { error: { message: 'phases exploded' } },
    });

    await expect(
      resolveMatchLengths(client, EVENT, [
        { id: 'm1', phaseId: 'p1', plannedDurationOverrideMinutes: null },
      ]),
    ).rejects.toThrow('phases exploded');
  });

  it('refuses a failed bracket read rather than inventing a length', async () => {
    const { client } = db({
      event_programme_configs: { rows: sheetRow() },
      phases: { rows: [phase('p1', 'single_elim')] },
      matches: { error: { message: 'matches exploded' } },
    });

    await expect(
      resolveMatchLengths(client, EVENT, [
        { id: 'm1', phaseId: 'p1', plannedDurationOverrideMinutes: null },
      ]),
    ).rejects.toThrow('matches exploded');
  });
});

describe('resolveMatchWindows', () => {
  it('builds a half-open window from the resolved length', async () => {
    const { client } = db({
      event_programme_configs: { rows: sheetRow({ poolMatchDurationMinutes: 7 }) },
      phases: { rows: [phase('p1', 'pool')] },
    });

    const windows = await resolveMatchWindows(client, EVENT, [
      {
        id: 'm1',
        phaseId: 'p1',
        plannedDurationOverrideMinutes: null,
        scheduledAt: '2026-06-06T08:00:00.000Z',
      },
    ]);

    const start = Date.parse('2026-06-06T08:00:00.000Z');
    expect(windows.get('m1')).toEqual({
      durationMinutes: 7,
      startMs: start,
      endMs: start + 7 * 60_000,
    });
  });

  it('gives a Match with no time no window', async () => {
    const { client } = db({
      event_programme_configs: { rows: sheetRow() },
      phases: { rows: [phase('p1', 'pool')] },
    });

    const windows = await resolveMatchWindows(client, EVENT, [
      { id: 'm1', phaseId: 'p1', plannedDurationOverrideMinutes: null, scheduledAt: null },
    ]);

    expect(windows.get('m1')).toBeNull();
  });
});
