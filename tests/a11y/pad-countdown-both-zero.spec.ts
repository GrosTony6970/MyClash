/**
 * A bout of one round that counts down, both fighters out of points on one
 * exchange, with no network (operator ruling of 2026-10-11).
 *
 * Countdown from 3. Red has 1 point left, blue has 2. Red strikes for 3 and
 * blue answers with an afterblow of 3: red is at -2, blue at -1. The board
 * stops at 0 – 0 and blue, the fighter less far below zero, has won. The
 * official ends the bout on the tablet: no question "end now?", no "level,
 * the time is not finished", and the result names blue.
 *
 * Before, the tablet read that board as level: a Pool bout could end only at
 * its time, as a draw, and a bracket bout could not end until the network was
 * back. The rule has its unit tests (`end-guard.test.ts`,
 * `pad-series.countdown-zero.test.ts`); what the server does with the same
 * exchange has its own (`scoring.service.countdown-zero.test.ts`).
 */
import { test, expect, type Page } from '@playwright/test';
import { openBout, result } from './pad-clock-stub';

/** First to lose 3, both fighters score on an afterblow, one afterblow button: 3 each way. */
const RULES = {
  scoringConfig: {
    afterblowMode: 'full',
    buttons: {
      clean: [{ label: '+1', value: 1, visible: true }],
      afterblow: [{ label: '3-3', attackerPts: 3, defenderPts: 3, visible: true }],
    },
    display: { sideColors: { red: 'red', blue: 'blue' } },
  },
  matchFormat: {
    pointCap: 3,
    scoringDirection: 'reverse_zero_loses',
    timerMode: 'countdown',
    timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 },
    softClockLimitSeconds: 5,
    maxDoubleHits: null,
    maxDoubleHitOutcome: 'double_loss_zero_scores',
    bestOf: { pool: 1, bracket: 1, finals: 1 },
    levelAtTime: {
      pool: [{ kind: 'draw' }],
      bracket: [{ kind: 'sudden_death' }],
      finals: [{ kind: 'sudden_death' }],
    },
  },
};

const column = (page: Page, side: 'red' | 'blue') =>
  page.locator(`[data-testid="scoring-column"][data-side="${side}"]`);
const numeral = (page: Page, side: 'red' | 'blue') => column(page, side).locator('p').first();

test('a countdown bout in play at 0 – 0 reads 0 – 0 when its sheet explains it, and cap to cap when it does not', async ({
  page,
}) => {
  // A bout the doubles limit ended at 0 – 0, put back in play: the server's
  // row is 0 – 0 and its sheet holds the doubles. Both fighters ARE out of points.
  const double = {
    id: 'd1',
    client_uuid: 'd1',
    sequence: 1,
    type: 'double',
    voided: false,
    occurredAt: '2026-01-01T10:00:05.000Z',
    round_number: 1,
  };
  const inPlay = {
    // A Pool bout with a doubles limit of one: the one double of the sheet explains the 0 – 0.
    rules: { ...RULES, matchFormat: { ...RULES.matchFormat, maxDoubleHits: 1 } },
    row: { status: 'paused', red_score: 0, blue_score: 0 },
    clock: { status: 'halted' as const, activeMs: 10_000, startedAt: '2026-01-01T10:00:00.000Z' },
  };
  await openBout(page, { ...inPlay, sheet: [double] });
  await expect(column(page, 'red').getByTestId('afterblow-button')).toHaveCount(1);
  await expect(numeral(page, 'red')).toHaveText('0');
  await expect(numeral(page, 'blue')).toHaveText('0');

  // The same row over an empty sheet: nobody has scored, and both hold the cap.
  await page.unrouteAll({ behavior: 'wait' });
  await openBout(page, inPlay);
  await expect(column(page, 'red').getByTestId('afterblow-button')).toHaveCount(1);
  await expect(numeral(page, 'red')).toHaveText('3');
  await expect(numeral(page, 'blue')).toHaveText('3');
});

for (const phaseType of ['pool', 'single_elim']) {
  test(`with no network, a ${phaseType} bout that counts down ends for the fighter less far below zero`, async ({
    page,
  }) => {
    // The bout is in play, its clock halted after ten seconds of ninety.
    const stub = await openBout(page, {
      rules: RULES,
      phaseType,
      row: { status: 'paused', red_score: 1, blue_score: 2 },
      clock: { status: 'halted', activeMs: 10_000, startedAt: '2026-01-01T10:00:00.000Z' },
    });
    await expect(numeral(page, 'red')).toHaveText('1');
    await expect(numeral(page, 'blue')).toHaveText('2');
    // The Tournament's rules are read: one afterblow button, not the default two.
    const afterblow = column(page, 'red').getByTestId('afterblow-button');
    await expect(afterblow).toHaveCount(1);
    stub.network = 'down';

    await afterblow.click();

    // Both are out of points, and the board stops at zero.
    await expect(numeral(page, 'red')).toHaveText('0');
    await expect(numeral(page, 'blue')).toHaveText('0');

    await page.getByTestId('clock-end-button').click();

    // No question and no refusal: the bout has a winner.
    await expect(result(page)).toBeVisible();
    await expect(page.getByTestId('end-early-confirm')).toHaveCount(0);
    await expect(page.getByTestId('match-result-unconfirmed')).toContainText(/not confirmed/i);
    await expect(page.getByTestId('match-result-winner')).toContainText('Bo Blue');
    await expect(page.getByTestId('match-result-draw')).toHaveCount(0);
    await expect(page.getByTestId('match-result-score')).toHaveText('0 – 0');
    expect(stub.sent, 'nothing reached the server').toEqual([]);
  });
}
