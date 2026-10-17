/**
 * The doubles chip counts what the server counts: the doubles of the OPEN round
 * of a best-of bout, under the limit the server applies (a pool and a Swiss
 * round have one, a bracket has none).
 *
 * It counted every round of the bout and showed the limit on every bout. In
 * round 2 of a best-of-3 with two doubles in round 1 it read `2/4`, in warning
 * colours, while the server's round 2 held none.
 *
 * The API is stubbed. `padSeries` has the unit tests (`pad-series.test.ts`).
 */
import { test, expect, type Page } from '@playwright/test';

const PAD = 'http://localhost:3002';
const BOUT = 'match-1';
const ROW = {
  id: BOUT,
  match_number_label: 'M1',
  status: 'paused',
  ruleset_code: 'TF',
  ruleset_version: '1.0.0',
  decision_edition: '2026-10',
  red_registration_id: 'red-1',
  blue_registration_id: 'blue-1',
  red_score: 0,
  blue_score: 0,
  winner_registration_id: null,
  locked_at: null,
  lice_id: null,
  end_reason: null,
  current_round: 2,
  red_round_wins: 1,
  blue_round_wins: 0,
  rounds_json: [{ round: 1, redScore: 3, blueScore: 1, winnerColor: 'red' }],
  awaiting_round_advance: false,
};
const HALTED = {
  status: 'halted',
  activeMs: 0,
  totalActiveMs: 0,
  startedAt: '2026-01-01T10:00:00.000Z',
  levelResolutionSteps: 0,
};

/** A double of the server's list, as `GET /matches/:id/exchanges` gives a row. */
const double = (n: number, round: number) => ({
  id: `hit-${n}`,
  client_uuid: `uuid-hit-${n}`,
  sequence: n,
  type: 'double',
  voided: false,
  occurredAt: `2026-01-01T10:00:0${n}.000Z`,
  round_number: round,
});

async function openBout(page: Page, bout: { phaseType: string; bestOf: number; hits: unknown[] }) {
  await page.route('**/api/**', (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/api/v1/me')) return route.fulfill({ json: { type: 'anonymous' } });
    if (method === 'POST' && path.endsWith('/exchanges')) {
      // The server keeps the hit in the open round, so the list read that
      // follows the send holds it: the count below is no passing state.
      const hit = route.request().postDataJSON() as { clientUuid: string; type: string };
      bout.hits = [
        ...bout.hits,
        { ...double(9, ROW.current_round), client_uuid: hit.clientUuid, type: hit.type },
      ];
      return route.fulfill({ status: 201, json: { id: 'saved' } });
    }
    if (method !== 'GET') return route.fulfill({ json: {} });
    if (path.endsWith(`/matches/${BOUT}`)) return route.fulfill({ json: ROW });
    if (path.endsWith('/summary')) {
      return route.fulfill({
        json: {
          roundCode: 'P1',
          redName: 'Ana Red',
          blueName: 'Bo Blue',
          weapon: 'longsword',
          phaseType: bout.phaseType,
          bestOf: bout.bestOf,
        },
      });
    }
    if (path.endsWith('/exchanges')) return route.fulfill({ json: bout.hits });
    if (path.endsWith('/penalties')) return route.fulfill({ json: [] });
    if (path.endsWith('/clock')) return route.fulfill({ json: HALTED });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${PAD}/matches/${BOUT}`);
  await expect(page.getByTestId('clock-primary-button')).toBeEnabled();
}

const chip = (page: Page) => page.getByTestId('double-count');
// The word beside the count (quick win P20): a touch screen has no hover.
const caption = (page: Page) => page.getByTestId('double-count-caption');

test('in round 2 of a best-of bout the chip counts the doubles of round 2', async ({ page }) => {
  await openBout(page, {
    phaseType: 'pool',
    bestOf: 3,
    hits: [double(1, 1), double(2, 1), double(3, 2)],
  });

  // The header says round 2: the bout is read as a best-of.
  await expect(page.getByText(/round 2/i).first()).toBeVisible();
  await expect(chip(page)).toHaveAttribute('data-count', '1');
  await expect(chip(page)).toHaveText('1/4');
  await expect(caption(page)).toHaveText('Doubles, this round');
  await expect(chip(page)).toHaveAttribute('title', /in this round/);

  // A double tapped now is of round 2 as well.
  await page.getByTestId('double-button').click();
  await expect(chip(page)).toHaveAttribute('data-count', '2');
});

test('a single-round pool bout counts every double, under the limit', async ({ page }) => {
  await openBout(page, { phaseType: 'pool', bestOf: 1, hits: [double(1, 1), double(2, 1)] });

  await expect(chip(page)).toHaveText('2/4');
  await expect(caption(page)).toHaveText('Doubles');
  await expect(chip(page)).toHaveAttribute('title', /of the match/);
});

test('a bracket bout shows no doubles limit: the server applies none', async ({ page }) => {
  await openBout(page, { phaseType: 'single_elim', bestOf: 1, hits: [double(1, 1)] });

  await expect(chip(page)).toHaveText('1/∞');
});
