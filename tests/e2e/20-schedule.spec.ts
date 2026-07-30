import { test, expect } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_api';
import { createBracketTournament, ensureRoster } from './_bracket';

/**
 * What the schedule generator actually PROMISES (run with `E2E_SCHEDULE=1`).
 *
 * `04-schedule.spec.ts` asserts `matchesScheduled > 0` and nothing else — which
 * a generator that dumped every match onto one lice at the same instant would
 * satisfy. The real contract is in `match-scheduler.ts`'s own header:
 *
 *   2. For each unscheduled match, find the earliest Lice slot where:
 *      - Both fighters have had at least minRestMinutes since their last match.
 *      - The Lice is available (previous match has ended).
 *
 * Those are three separate invariants — a lice never running two matches at
 * once, a fighter never being in two at once, and a fighter's consecutive bouts
 * being at least `minRestMinutes` apart — and NOTHING checked any of them
 * against real generated rows. They are the difference between a timetable and
 * a list of times.
 *
 * IT BUILDS ITS OWN `event_kind: 'test'` EVENT. The shared throwaway event
 * accumulates other specs' tournaments, lices and blocks, and
 * `programme/generate` is event-wide — so an invariant checked there would be
 * measuring whatever `04`, `05` and `18` happened to leave behind. Here the
 * event contains exactly what this spec put in it.
 */
const SCHEDULE = ['1', 'true', 'yes'].includes((process.env.E2E_SCHEDULE ?? '').toLowerCase());

/** Block configuration. Every expectation below is derived from these. */
const LICE_COUNT = 2;
const POOL_COUNT = 2;
const MATCH_MINUTES = 5;
const MIN_REST_MINUTES = 20;
const BLOCK_START = '09:00';
const BLOCK_END = '18:00';

interface GridMatch {
  id: string;
  liceId: string | null;
  scheduledAt: string | null;
  durationMinutes: number;
  redRegistrationId: string;
  blueRegistrationId: string;
  poolId: string | null;
}

/** A placed match, reduced to the interval arithmetic the invariants need. */
interface Placed {
  id: string;
  liceId: string;
  start: number;
  end: number;
  poolId: string | null;
  fighters: string[];
}

test.describe('schedule', () => {
  test.skip(!SCHEDULE, 'set E2E_SCHEDULE=1 to hold the generator to its own contract');

  test('generate places matches without double-booking a lice, a fighter, or their rest', async ({
    request,
  }) => {
    test.setTimeout(240_000);
    const api = apiFor(request);
    const { orgId } = runContext();
    const token = Date.now().toString(36);

    // ── An event containing nothing but this spec's work ──────────────────────
    const event = await api.json<{ id: string }>(
      await api.post(`organizations/${orgId}/events`, {
        data: {
          name: `E2E TEST (auto) schedule — ${token}`,
          slug: `e2e-schedule-${token}`,
          startDate: '2099-03-01',
          endDate: '2099-03-02',
          city: 'Testville',
          country: 'FR',
          eventKind: 'test',
        },
      }),
    );
    const eventId = event.id;

    // The generator picks the event's lices itself; the spec only has to make
    // sure exactly LICE_COUNT of them exist.
    for (let i = 1; i <= LICE_COUNT; i++) {
      await api.ok(await api.post(`events/${eventId}/lices`, { data: { name: `Piste ${i}` } }));
    }

    // 8 fighters over 2 pools of 4 → 6 matches per pool, and EVERY fighter
    // appears three times. That repetition is what makes the rest rule
    // observable at all: with one match each, no fighter ever waits.
    const fighters = await ensureRoster(
      api,
      eventId,
      Array.from({ length: 8 }, (_, i) => ({
        givenName: 'Sched',
        familyName: `F${String(i + 1).padStart(2, '0')}`,
      })),
    );
    const tournament = await createBracketTournament(api, eventId, {
      name: `Schedule Cup ${token}`,
      slug: `sched-${token}`,
      fighters,
    });
    await api.ok(
      await api.post(`tournaments/${tournament.id}/generate-pools`, {
        data: { poolCount: POOL_COUNT },
      }),
    );

    // ── `suggest` proposes a day before anything is committed ─────────────────
    const suggestion = await api.json<{ blocks?: unknown[] }>(
      await api.post(`events/${eventId}/programme/suggest`, {
        data: {
          dayStartTime: BLOCK_START,
          dayEndTime: BLOCK_END,
          parallelLiceCount: LICE_COUNT,
          poolMatchDurationMinutes: MATCH_MINUTES,
          eliminationMatchDurationMinutes: MATCH_MINUTES,
          finalsMatchDurationMinutes: MATCH_MINUTES,
          matchGapSeconds: 0,
          minRestMinutes: MIN_REST_MINUTES,
          breakBetweenSessionsMinutes: 15,
          middayBreakStart: '12:00',
          middayBreakEnd: '13:00',
          registrationDurationMinutes: 30,
          gearCheckDurationMinutes: 30,
          refereeMeetingDurationMinutes: 15,
        },
      }),
    );
    expect(
      (suggestion.blocks ?? []).length,
      'suggest must propose a day, not an empty programme',
    ).toBeGreaterThan(0);

    // ── The block this spec actually commits ──────────────────────────────────
    // `createBlock` answers `{ block }`, not the block itself.
    const { block } = await api.json<{ block: { id: string } }>(
      await api.post(`events/${eventId}/programme/blocks`, {
        data: {
          dayIndex: 0,
          blockType: 'competition',
          label: `Pools ${token}`,
          startTime: BLOCK_START,
          endTime: BLOCK_END,
          liceCount: LICE_COUNT,
          matchGapSeconds: 0,
          matchDurationMinutes: MATCH_MINUTES,
          minRestMinutes: MIN_REST_MINUTES,
          competitionId: tournament.id,
          competitionPhase: 'pool',
        },
      }),
    );
    // Guard the id itself. Without this, a wrong response shape turns every
    // block-addressed call below into `/blocks/undefined/...`, which the UUID
    // pipe rejects with its OWN 400 — and a bare `toBe(400)` would have called
    // that a pass. (It did, on the first run of this spec.)
    expect(block?.id, 'createBlock must return the block it created').toMatch(/^[0-9a-f-]{36}$/i);

    const generated = await api.json<{ matchesScheduled: number }>(
      await api.post(`events/${eventId}/programme/generate`, { data: {} }),
    );
    // 2 pools of 4 is 6 matches each — the count is knowable, not just positive.
    const expectedMatches = POOL_COUNT * 6;
    expect(generated.matchesScheduled, 'every pool match must be placed').toBe(expectedMatches);

    const placed = await readPlaced(api, eventId);
    expect(placed.length, 'the grid must show every generated match as placed').toBe(
      expectedMatches,
    );

    // ── Invariant 1: one lice runs one match at a time ────────────────────────
    for (const liceId of new Set(placed.map((p) => p.liceId))) {
      const onLice = placed.filter((p) => p.liceId === liceId).sort((a, b) => a.start - b.start);
      for (let i = 1; i < onLice.length; i++) {
        const previous = onLice[i - 1]!;
        const current = onLice[i]!;
        expect(
          current.start,
          `two matches overlap on one piste: ${previous.id} runs to ${iso(previous.end)} but ` +
            `${current.id} starts at ${iso(current.start)}`,
        ).toBeGreaterThanOrEqual(previous.end);
      }
    }

    // ── Invariant 2: nobody fights in two places at once ──────────────────────
    // The one that would ruin a real event: a fighter called to two pistes
    // simultaneously simply cannot answer both.
    for (const [fighter, bouts] of byFighter(placed)) {
      for (let i = 1; i < bouts.length; i++) {
        const previous = bouts[i - 1]!;
        const current = bouts[i]!;
        expect(
          current.start,
          `fighter ${fighter} is double-booked: ${previous.id} (${iso(previous.start)}–` +
            `${iso(previous.end)}) overlaps ${current.id} at ${iso(current.start)}`,
        ).toBeGreaterThanOrEqual(previous.end);
      }
    }

    // ── Invariant 3: the rest minimum is honoured ─────────────────────────────
    // Asserted from the block's OWN minRestMinutes, so it stays true if the
    // constant above changes.
    const minRestMs = MIN_REST_MINUTES * 60_000;
    for (const [fighter, bouts] of byFighter(placed)) {
      for (let i = 1; i < bouts.length; i++) {
        const gap = bouts[i]!.start - bouts[i - 1]!.end;
        expect(
          gap,
          `fighter ${fighter} gets only ${Math.round(gap / 60_000)} min between ` +
            `${bouts[i - 1]!.id} and ${bouts[i]!.id}; the block promises ${MIN_REST_MINUTES}`,
        ).toBeGreaterThanOrEqual(minRestMs);
      }
    }

    // ── Invariant 4: a pool stays on one piste ────────────────────────────────
    // `poolAffinity: 'strict'` is the default, and it is what lets an operator
    // point at a piste and say "pool 2 is over there".
    const licesPerPool = new Map<string, Set<string>>();
    for (const p of placed) {
      if (!p.poolId) continue;
      const set = licesPerPool.get(p.poolId) ?? new Set<string>();
      set.add(p.liceId);
      licesPerPool.set(p.poolId, set);
    }
    expect(licesPerPool.size, 'both pools must appear in the grid').toBe(POOL_COUNT);
    for (const [poolId, lices] of licesPerPool) {
      expect([...lices], `pool ${poolId} was split across pistes`).toHaveLength(1);
    }
    // …and the two pools did not both land on the SAME piste, which would make
    // the affinity assertion above vacuously true on a single-lice schedule.
    expect(
      new Set([...licesPerPool.values()].map((s) => [...s][0])).size,
      'the two pools must occupy different pistes — otherwise nothing was parallelised',
    ).toBe(POOL_COUNT);

    // ── Resize refuses a window that ends before it starts ────────────────────
    // The ONE validation resize performs (`timeToMin(end) <= timeToMin(start)`).
    // Overlap with a neighbouring block is deliberately NOT validated, so this
    // spec does not pretend it is.
    const badResize = await api.patch(`events/${eventId}/programme/blocks/${block.id}/resize`, {
      data: { newEndTime: '08:00' },
    });
    expect(
      badResize.status(),
      `a block cannot end before it starts: ${(await badResize.text()).slice(0, 200)}`,
    ).toBe(400);
    expect(await badResize.text()).toMatch(/must be after start/i);

    // A legal resize is accepted and stored.
    await api.ok(
      await api.patch(`events/${eventId}/programme/blocks/${block.id}/resize`, {
        data: { newEndTime: '17:00' },
      }),
    );
    expect((await readBlock(api, eventId, block.id)).endTime).toMatch(/^17:00/);

    // ── Move cascade-shifts the matches with the block ────────────────────────
    // The documented behaviour: every match at or after the block's OLD start
    // moves by the same Δ. If the bar moved and the matches did not, the grid
    // would show an empty block and matches floating outside it.
    const before = new Map(placed.map((p) => [p.id, p.start]));
    await api.ok(
      await api.patch(`events/${eventId}/programme/blocks/${block.id}/move`, {
        data: { newStartTime: '10:00' },
      }),
    );
    const shifted = await readPlaced(api, eventId);
    const deltaMs = 60 * 60_000;
    for (const match of shifted) {
      const was = before.get(match.id);
      expect(was, 'move must not lose a match').toBeDefined();
      expect(match.start - (was as number), `match ${match.id} did not follow its block`).toBe(
        deltaMs,
      );
    }

    // ── Deleting the block unschedules what was inside it ─────────────────────
    // Documented: matches inside the window return to the Unscheduled sidebar
    // rather than being orphaned at a time no block covers.
    await api.ok(await api.delete(`events/${eventId}/programme/blocks/${block.id}`));
    const after = await api.json<GridMatch[]>(await api.get(`events/${eventId}/schedule`));
    const stillPlaced = after.filter((m) => m.scheduledAt !== null || m.liceId !== null);
    expect(
      stillPlaced.map((m) => m.id),
      'deleting the block must return its matches to the unscheduled pile',
    ).toEqual([]);

    // ── Clean up: this event is disposable by construction ────────────────────
    if (process.env.E2E_CLEANUP) {
      await api.delete(`events/${eventId}`);
    } else {
      console.log(`[e2e] schedule event PRESERVED: ${eventId}`);
    }
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const iso = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/** Every placed match, as intervals. Throws if the grid is missing timings. */
async function readPlaced(api: Api, eventId: string): Promise<Placed[]> {
  const grid = await api.json<GridMatch[]>(await api.get(`events/${eventId}/schedule`));
  return grid
    .filter((m) => m.scheduledAt !== null && m.liceId !== null)
    .map((m) => {
      const start = new Date(m.scheduledAt as string).getTime();
      return {
        id: m.id,
        liceId: m.liceId as string,
        start,
        // The grid reports the duration the generator used; deriving the end
        // from it keeps the overlap arithmetic honest to what was planned.
        end: start + m.durationMinutes * 60_000,
        poolId: m.poolId,
        fighters: [m.redRegistrationId, m.blueRegistrationId].filter(Boolean),
      };
    });
}

/** registrationId → that fighter's bouts, in time order. */
function byFighter(placed: Placed[]): Map<string, Placed[]> {
  const out = new Map<string, Placed[]>();
  for (const match of placed) {
    for (const fighter of match.fighters) {
      out.set(fighter, [...(out.get(fighter) ?? []), match]);
    }
  }
  for (const bouts of out.values()) bouts.sort((a, b) => a.start - b.start);
  return out;
}

async function readBlock(
  api: Api,
  eventId: string,
  blockId: string,
): Promise<{ startTime: string; endTime: string }> {
  // `GET programme` answers a BARE ARRAY of blocks (createBlock, by contrast,
  // wraps its result in `{ block }` — the two shapes do not match).
  const blocks = await api.json<Array<{ id: string; startTime: string; endTime: string }>>(
    await api.get(`events/${eventId}/programme`),
  );
  const block = blocks.find((b) => b.id === blockId);
  expect(block, `block ${blockId} vanished from the programme`).toBeDefined();
  return block as { startTime: string; endTime: string };
}
