import { test, expect, type Locator } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_api';
import { createBracketTournament, ensureRoster, personName } from './_bracket';

/**
 * The scoring pad's OTHER buttons, clicked in a real browser
 * (run with `E2E_PAD_UI=1`; see README for the full rationale).
 *
 * `4075243e` — the pad could not record a single exchange — broke ALL FOUR
 * exchange types, and reached production because the only exchange any browser
 * test ever clicked was `clean-hit-button` (`06`/`08`).
 * `10-scoring-pad.spec.ts` cannot close that gap: it composes its own request
 * bodies, and the bug was in how the PAD composes them. So every action here is
 * a real click, and every assertion is on what the server ended up holding.
 *
 * The invariant threaded through it is AGENTS.md rule #1: score is DERIVED from
 * exchanges, never stored as the source of truth.
 *
 * Ordering is deliberate — the clock comes LAST, because ending it raises the
 * result overlay, which intercepts every subsequent click.
 *
 * Event-scoped, so `global-teardown`'s hard-delete cleans it up.
 */
const PAD_UI = ['1', 'true', 'yes'].includes((process.env.E2E_PAD_UI ?? '').toLowerCase());

// Only the fields this spec actually reads — a local interface over a response
// shape is a second copy of the contract, so it stays as narrow as possible.
interface MatchRow {
  status: string;
  red_score: number | null;
  blue_score: number | null;
}

/** One row of `GET matches/:id/exchanges` (raw snake_case + camelCase aliases). */
interface ExchangeRow {
  type: string;
  first_striker_color: 'red' | 'blue' | null;
  first_strike_value: number | null;
  afterblow_value: number | null;
  no_exchange_reason: string | null;
  red_score_delta: number;
  blue_score_delta: number;
  voided: boolean;
}

interface PenaltyRow {
  registration_id: string;
  ruleset_entry_id: string | null;
  score_delta: number | null;
  voided: boolean;
}

interface PenaltyEntry {
  id: string;
  group_number: number;
  ref_number: number;
  sanctions: string[];
}

test.describe('scoring pad UI', () => {
  test.skip(!PAD_UI, 'set E2E_PAD_UI=1 to click every pad control in a real browser');

  test('every exchange type, a card and the clock, driven from the pad itself', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);
    const { eventId, baseURL } = runContext();
    const token = Date.now().toString(36);
    // Same-origin through the admin `/scoring/*` proxy by default — the path
    // organizers actually use, and the one with a trusted cert. `06` documents
    // the override.
    const staffBase = (process.env.E2E_STAFF_URL ?? `${baseURL}/staff`).replace(/\/$/, '');

    const match = await aPoolMatch(api, eventId, token);

    // ── Server-side readers ───────────────────────────────────────────────────
    const readMatch = async (): Promise<MatchRow> =>
      api.json<MatchRow>(await api.get(`matches/${match.matchId}`));
    const readExchanges = async (): Promise<ExchangeRow[]> =>
      api.json<ExchangeRow[]>(await api.get(`matches/${match.matchId}/exchanges`));
    const readPenalties = async (): Promise<PenaltyRow[]> =>
      api.json<PenaltyRow[]>(await api.get(`matches/${match.matchId}/penalties`));
    const exchangeCount = async (): Promise<number> => (await readExchanges()).length;

    /**
     * AGENTS.md rule #1, after every click: the persisted score must be BOTH the
     * expected figure AND the figure the stored rows imply. The derived side
     * sums the engine's own per-row deltas plus each penalty's `score_delta`
     * (which lands on the CARDED fighter, the way `ScoringService` applies it),
     * so a click that lands the wrong type, on the wrong side or with the wrong
     * values fails here instead of quietly agreeing with a hard-coded number.
     */
    const expectScore = async (label: string, red: number, blue: number): Promise<void> => {
      const [row, exchanges, penalties] = await Promise.all([
        readMatch(),
        readExchanges(),
        readPenalties(),
      ]);
      const live = <T extends { voided: boolean }>(rows: T[]) => rows.filter((r) => !r.voided);
      const derived = { red: 0, blue: 0 };
      for (const e of live(exchanges)) {
        derived.red += e.red_score_delta;
        derived.blue += e.blue_score_delta;
      }
      for (const p of live(penalties)) {
        if (p.registration_id === match.redRegistrationId) derived.red += p.score_delta ?? 0;
        if (p.registration_id === match.blueRegistrationId) derived.blue += p.score_delta ?? 0;
      }
      expect({ red: row.red_score, blue: row.blue_score }, `[${label}] persisted score`).toEqual({
        red,
        blue,
      });
      expect(derived, `[${label}] the score derived from the stored rows`).toEqual({ red, blue });
    };

    // ── Pad locators ──────────────────────────────────────────────────────────
    const column = (side: 'red' | 'blue'): Locator =>
      page.locator(`[data-testid="scoring-column"][data-side="${side}"]`);
    const cleanHit = (side: 'red' | 'blue', label: string): Locator =>
      column(side).getByTestId('clean-hit-button').filter({ hasText: label }).first();
    const afterblow = (side: 'red' | 'blue', label: string): Locator =>
      column(side).getByTestId('afterblow-button').filter({ hasText: label }).first();
    const clockStatus = page.getByTestId('clock-status');
    const primaryClock = page.getByTestId('clock-primary-button');

    // ── Count what the pad asks the server for ────────────────────────────────
    /**
     * Wrap `window.fetch` BEFORE the app loads, and count what the APP asked
     * for rather than what left the machine.
     *
     * `page.on('request')` is the obvious instrument and the wrong one here: the
     * pad's browser API base is same-origin, so every `/api/*` call goes through
     * the service worker, which attributes the outbound request to the worker
     * rather than the page. The wrap sits in front of that.
     *
     * Method is recorded with the path because the drain POSTs to
     * `/matches/:id/exchanges` and a card POSTs to `/matches/:id/penalties` —
     * the same paths the reads use. A substring match would count the write
     * under test and turn "one" into "two".
     */
    await page.addInitScript(() => {
      const log: string[] = [];
      (window as unknown as { __apiCalls: string[] }).__apiCalls = log;
      const original = window.fetch.bind(window);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : (input as Request).url;
        const method = (
          init?.method ??
          (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET')
        ).toUpperCase();
        log.push(`${method} ${url}`);
        return original(input as RequestInfo, init);
      };
    });
    const apiCalls = (): Promise<string[]> =>
      page.evaluate(() => (window as unknown as { __apiCalls: string[] }).__apiCalls.slice());

    // ── Open the pad ──────────────────────────────────────────────────────────
    await page.goto(`${staffBase}/matches/${match.matchId}`);
    await expect(page.getByTestId('network-bar')).toHaveAttribute('data-network', 'online', {
      timeout: 30_000,
    });
    // Match running + clock idle → `canScore`. Everything up to step 6 needs it.
    await expect(cleanHit('red', '+2')).toBeEnabled({ timeout: 30_000 });
    await expect(clockStatus).toHaveAttribute('data-status', 'idle');
    expect(await exchangeCount(), 'the match must start with no exchanges').toBe(0);

    // ── 1) A clean hit — the one type that was already covered ────────────────
    // Kept as the baseline the rest is measured against, and as a check that the
    // TF_v1 grammar reached the pad (a `+2` button at all).
    const callsBeforeHit = (await apiCalls()).length;
    await cleanHit('red', '+2').click();
    await expect.poll(exchangeCount, { timeout: 20_000 }).toBe(1);

    /**
     * ONE READ PER ENDPOINT PER SCORED HIT.
     *
     * Four components used to call `usePenalties` — `ScoringColumn` renders
     * once per fighter, plus the centre column, plus the corrections drawer,
     * which is mounted whether or not it is open. Three requests each, re-run on
     * every hit: twelve. `useExchanges` added two more and `/neighbors` two.
     *
     * Counted, not asserted in prose. The re-check after the derived UI settles
     * is the load-bearing half: polling to 1 and stopping would pass on the
     * first sample and never see a fifth request arriving 200ms later.
     */
    const scoredHitReads = async (): Promise<Record<string, number>> => {
      const calls = (await apiCalls()).slice(callsBeforeHit).filter((c) => c.startsWith('GET '));
      const count = (path: string) => calls.filter((c) => c.includes(path)).length;
      // The three penalty paths do not overlap as substrings: `/penalties` is
      // not inside `/penalty-ruleset` or `/penalty-scope`.
      return {
        penaltyRuleset: count('/penalty-ruleset'),
        penaltyScope: count('/penalty-scope'),
        penalties: count('/penalties'),
        exchanges: count('/exchanges'),
        neighbors: count('/neighbors'),
      };
    };
    await expect.poll(async () => (await scoredHitReads()).exchanges, { timeout: 20_000 }).toBe(1);
    const reads = await scoredHitReads();
    expect(reads, 'one read per endpoint per scored hit').toEqual({
      penaltyRuleset: 1,
      penaltyScope: 1,
      penalties: 1,
      exchanges: 1,
      neighbors: 1,
    });
    const clean = (await readExchanges())[0]!;
    expect({
      type: clean.type,
      side: clean.first_striker_color,
      value: clean.first_strike_value,
    }).toEqual({ type: 'clean', side: 'red', value: 2 });
    await expectScore('clean', 2, 0);

    // ── 2) Double — scores for nobody, but MUST be recorded ───────────────────
    // The double count drives the max-doubles rule, so a dropped double changes
    // who wins a pool. The chip is the pad's own read of that count.
    await page.getByTestId('double-button').click();
    await expect.poll(exchangeCount, { timeout: 20_000 }).toBe(2);
    const double = (await readExchanges())[1]!;
    expect({
      type: double.type,
      side: double.first_striker_color,
      value: double.first_strike_value,
    }).toEqual({ type: 'double', side: null, value: null });
    await expect(page.getByTestId('double-count')).toHaveAttribute('data-count', '1');
    await expectScore('double', 2, 0);

    // ── 3) No exchange — via the reason picker ────────────────────────────────
    // The button now opens a picker instead of recording straight away. Choose a
    // reason that is NOT 'other' on purpose: 'other' is what the pad used to
    // hard-code for every no-exchange, so it is the one value that cannot prove
    // the referee's choice actually reached the row.
    await page.getByTestId('no-exchange-button').click();
    const reasonPicker = page.getByTestId('no-exchange-reason');
    await expect(reasonPicker.first()).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="no-exchange-reason"][data-reason="out_of_bounds"]').click();
    // One tap records AND dismisses — no separate confirm step mid-bout.
    await expect(reasonPicker.first()).toBeHidden({ timeout: 10_000 });
    await expect.poll(exchangeCount, { timeout: 20_000 }).toBe(3);
    const noExchange = (await readExchanges())[2]!;
    expect({ type: noExchange.type, reason: noExchange.no_exchange_reason }).toEqual({
      type: 'no_exchange',
      reason: 'out_of_bounds',
    });
    await expectScore('no exchange', 2, 0);

    // ── 4) Afterblow — RAW stored, mode applied at derivation ─────────────────
    // The `2-1` button under TF_v1's DEDUCTIVE mode nets the retaliation against
    // the attacker: +1, not +2. The row must still hold the raw 2 and 1, because
    // the mode is applied at every read and stats need blow fidelity.
    await afterblow('red', '2-1').click();
    await expect.poll(exchangeCount, { timeout: 20_000 }).toBe(4);
    const ab = (await readExchanges())[3]!;
    expect(
      {
        type: ab.type,
        side: ab.first_striker_color,
        raw: ab.first_strike_value,
        afterblow: ab.afterblow_value,
      },
      'the pad must send the RAW button values',
    ).toEqual({ type: 'afterblow', side: 'red', raw: 2, afterblow: 1 });
    expect({ red: ab.red_score_delta, blue: ab.blue_score_delta }, 'deductive netting').toEqual({
      red: 1,
      blue: 0,
    });
    await expectScore('afterblow', 3, 0);

    // ── 5) A penalty card, on BLUE ────────────────────────────────────────────
    // Which fighter a card lands on is the whole content of a sanction, and the
    // pad renders the picker twice — once per side. Clicking blue's copy must
    // card BLUE.
    const entry = await aCardingEntry(api, match.matchId);
    const blueChip = column('blue').locator(
      `[data-testid="card-chip"][data-card="${entry.sanctions[0]}"]`,
    );
    await expect(blueChip).toHaveAttribute('data-count', '0');

    await column('blue')
      .locator(`[data-testid="penalty-entry-button"][data-entry-id="${entry.id}"]`)
      .click();

    await expect.poll(async () => (await readPenalties()).length, { timeout: 20_000 }).toBe(1);
    const penalty = (await readPenalties())[0]!;
    expect(
      { registration: penalty.registration_id, entry: penalty.ruleset_entry_id },
      'the card must be recorded against BLUE, from the entry that was clicked',
    ).toEqual({ registration: match.blueRegistrationId, entry: entry.id });
    // The pad's own card counter agrees with the server.
    await expect(blueChip).toHaveAttribute('data-count', '1', { timeout: 20_000 });
    // Red's counter for the same colour must NOT have moved.
    await expect(
      column('red').locator(`[data-testid="card-chip"][data-card="${entry.sanctions[0]}"]`),
    ).toHaveAttribute('data-count', '0');
    // Red is untouched at 3; blue carries whatever delta the ruleset assigned.
    await expectScore('penalty', 3, penalty.score_delta ?? 0);

    // ── 6) Clock: start — and scoring locks ───────────────────────────────────
    // `canScore = scoringEnabled && !clockRunning`: a running clock means the
    // referee is watching the bout, not the tablet. Nothing covered this rule.
    await primaryClock.click();
    await expect(clockStatus).toHaveAttribute('data-status', 'running', { timeout: 20_000 });
    await expect(
      cleanHit('red', '+2'),
      'scoring must be locked while the clock runs',
    ).toBeDisabled();
    await expect(afterblow('red', '2-1')).toBeDisabled();
    await expect(page.getByTestId('double-button')).toBeDisabled();
    await expect(page.getByTestId('no-exchange-button')).toBeDisabled();
    await expect(primaryClock).toHaveAttribute('data-action', 'halt');

    // ── 7) halt — and scoring comes back ──────────────────────────────────────
    await primaryClock.click();
    await expect(clockStatus).toHaveAttribute('data-status', 'halted', { timeout: 20_000 });
    await expect(primaryClock).toHaveAttribute('data-action', 'resume');
    await expect(cleanHit('blue', '+1')).toBeEnabled({ timeout: 20_000 });

    // Scoring during a pause is how every correction gets made — it must reach
    // the server, and the clock position it stamps must be a real one.
    await cleanHit('blue', '+1').click();
    await expect.poll(exchangeCount, { timeout: 20_000 }).toBe(5);
    await expectScore('halted hit', 3, 1 + (penalty.score_delta ?? 0));

    // ── 8) resume ─────────────────────────────────────────────────────────────
    await primaryClock.click();
    await expect(clockStatus).toHaveAttribute('data-status', 'running', { timeout: 20_000 });

    // ── 9) End the match ──────────────────────────────────────────────────────
    // Ending the clock is one of only two ways a pad-scored match ever finishes
    // (the other is the point cap), and it is what completes the match row.
    await page.getByTestId('clock-end-button').click();
    await expect(clockStatus).toHaveAttribute('data-status', 'ended', { timeout: 20_000 });

    const overlay = page.getByTestId('match-result-overlay');
    await expect(overlay).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(async () => (await readMatch()).status, { timeout: 20_000 })
      .toBe('completed');
    // The score survived completion, and is still the derived one.
    await expectScore('completed', 3, 1 + (penalty.score_delta ?? 0));

    // The overlay reports what the server holds — read the row rather than
    // rebuilding the string from arithmetic, so this asserts the pad rendered
    // the persisted score and not a stale or placeholder one.
    const final = await readMatch();
    expect(
      final.red_score,
      'red must lead for the overlay to name red — a tie would read "draw" instead',
    ).toBeGreaterThan(final.blue_score as number);
    // SCOPED TO THE HEADLINE, not the whole overlay. `9579b3a2` added the bout
    // review — a flow chart and an exchange-by-exchange timeline — which names
    // BOTH fighters by design. Asked of the overlay, "does it name only the
    // winner" is really a question about the review and answers no; asked of
    // the headline, it is the announcement rule it was always meant to be.
    const headline = overlay.getByTestId('match-result-winner');
    await expect(headline, 'the headline announces the winner by score').toContainText(
      match.redName,
    );
    await expect(
      headline,
      'the headline announces ONE winner — naming both would make it a fixture list',
    ).not.toContainText(match.blueName);
    await expect(
      overlay.getByTestId('match-result-score'),
      'the overlay shows the final score',
    ).toHaveText(`${final.red_score} – ${final.blue_score}`);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

interface PadMatch {
  matchId: string;
  redRegistrationId: string;
  blueRegistrationId: string;
  redName: string;
  blueName: string;
}

/** One match row of `GET tournaments/:id/pools-with-matches`. */
interface PoolMatchRow {
  id: string;
  status: string;
  red_registration_id: string | null;
  blue_registration_id: string | null;
}

/**
 * One playable 2-fighter pool match to score against.
 *
 * A POOL match rather than a bracket slot because that is what a referee spends
 * the day on, and because `generate-pools` is the shortest path to a match row
 * wired to a phase and a ruleset. Built on `createBracketTournament`, which
 * already creates the tournament, registers the fighters in seed order and pins
 * the point cap to `POINT_CAP` (5) — comfortably above the 3 points this spec
 * scores, so `first_to_points` never fires and locks scoring out from under the
 * remaining steps.
 *
 * `PATCH /matches/:id/status` is used only to OPEN the match for scoring — a
 * test-only door (nothing in the product calls it), which is why the pad's own
 * completion path is what step 9 exercises.
 */
async function aPoolMatch(api: Api, eventId: string, token: string): Promise<PadMatch> {
  await api.ok(await api.post(`events/${eventId}/lices`, { data: { name: `Pad UI ${token}` } }));

  const fighters = await ensureRoster(api, eventId, [
    { givenName: 'Padui', familyName: 'Red' },
    { givenName: 'Padui', familyName: 'Blue' },
  ]);
  const tournament = await createBracketTournament(api, eventId, {
    name: `Pad UI Cup ${token}`,
    slug: `pad-ui-${token}`,
    fighters,
  });
  await api.ok(
    await api.post(`tournaments/${tournament.id}/generate-pools`, { data: { poolCount: 1 } }),
  );

  const pools = await api.json<Array<{ matches?: PoolMatchRow[] }>>(
    await api.get(`tournaments/${tournament.id}/pools-with-matches`),
  );
  const generated = pools
    .flatMap((p) => p.matches ?? [])
    .find((m) => m.red_registration_id && m.blue_registration_id && m.status !== 'completed');
  expect(generated, 'no playable pool match was generated').toBeDefined();
  await api.ok(await api.patch(`matches/${generated!.id}/status`, { data: { status: 'running' } }));

  // The pool generator decides which registration is red, so resolve the names
  // through the registration map rather than assuming the registration order.
  const nameOf = (registrationId: string): string => {
    const person = tournament.personByRegistrationId.get(registrationId);
    expect(person, `registration ${registrationId} is not one this spec created`).toBeDefined();
    return personName(person!);
  };
  const redRegistrationId = generated!.red_registration_id as string;
  const blueRegistrationId = generated!.blue_registration_id as string;

  return {
    matchId: generated!.id,
    redRegistrationId,
    blueRegistrationId,
    redName: nameOf(redRegistrationId),
    blueName: nameOf(blueRegistrationId),
  };
}

/**
 * A penalty entry that actually issues a card AND is on screen, from the ruleset
 * the pad itself resolves for this match (`GET matches/:id/penalty-ruleset`,
 * which falls back to the built-in FFAMHE set).
 *
 * Read from the deployed ruleset rather than hard-coded: the entries are
 * federation data, and a spec that named one by ref number would break the day
 * the rulebook is revised.
 *
 * Two constraints the pad imposes: the picker sorts by (group_number,
 * ref_number) and renders only the FIRST 30, so an entry past that window has no
 * button at all; and the entry must carry a sanction, or the card-counter chip
 * has nothing to count and step 5's sharpest assertion goes vacuous.
 */
const PICKER_VISIBLE_ENTRIES = 30;

async function aCardingEntry(api: Api, matchId: string): Promise<PenaltyEntry> {
  const ruleset = await api.json<{ penalty_ruleset_entries?: PenaltyEntry[] } | null>(
    await api.get(`matches/${matchId}/penalty-ruleset`),
  );
  const onScreen = [...(ruleset?.penalty_ruleset_entries ?? [])]
    .sort((a, b) => a.group_number - b.group_number || a.ref_number - b.ref_number)
    .slice(0, PICKER_VISIBLE_ENTRIES);
  const carding = onScreen.find((e) => (e.sanctions ?? []).length > 0);
  expect(
    carding,
    `no entry among the first ${PICKER_VISIBLE_ENTRIES} the picker renders issues a card — ` +
      'there is nothing to click, and the card-chip assertion would prove nothing',
  ).toBeDefined();
  return carding!;
}
