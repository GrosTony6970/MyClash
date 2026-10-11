/**
 * "End match" on a bout of one round at its doubles limit, with no network
 * (operator ruling of 2026-10-11).
 *
 * A Pool bout, doubles limit 2. The official taps the second double: the chip
 * reads 2/2 and the bout stays open, because the tablet ends no bout of one
 * round by itself. They tap "End match". The server will say what the format
 * says of a bout at its limit (a loss for both, 0 – 0), so the tablet says it
 * too: no question "end now?", no "level, the time is not finished", and the
 * result screen reads "Double loss", not confirmed.
 *
 * Before, the tablet named the leader on the board ("Ana Red, 2 – 0"), and it
 * refused the End of a level board until the time was finished: with no
 * network that bout could not be ended. And the result screen of a bout the
 * server had ended as a loss for both read "Draw".
 *
 * The rule has its unit tests (`end-guard.test.ts`); what the server writes
 * for the same sheet has its own (`scoring.service.countdown-doubles.test.ts`).
 * No story here goes back online: the stub's server is not the engine.
 */
import { test, expect, type Page } from '@playwright/test';
import { openBout, result } from './pad-clock-stub';

type Outcome = 'double_loss_zero_scores' | 'draw_zero_scores' | 'result_stands';

/** First to 3 (or first to lose 3), doubles limit 2, ninety seconds. */
const rules = (direction: 'normal' | 'reverse_zero_loses', outcome: Outcome) => ({
  scoringConfig: {
    afterblowMode: 'deductive',
    buttons: {
      clean: [{ label: '+1', value: 1, visible: true }],
      afterblow: [],
    },
    display: { sideColors: { red: 'red', blue: 'blue' } },
  },
  matchFormat: {
    pointCap: 3,
    scoringDirection: direction,
    timerMode: 'countdown',
    timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 },
    softClockLimitSeconds: 5,
    maxDoubleHits: 2,
    maxDoubleHitOutcome: outcome,
    bestOf: { pool: 1, bracket: 1, finals: 1 },
    levelAtTime: {
      pool: [{ kind: 'draw' }],
      bracket: [{ kind: 'sudden_death' }],
      finals: [{ kind: 'sudden_death' }],
    },
  },
});

interface Story {
  direction?: 'normal' | 'reverse_zero_loses';
  outcome?: Outcome;
  phaseType?: string;
  /** The server's row: the board before the doubles. */
  red: number;
  blue: number;
}

/**
 * Opens the bout in play, its clock halted after ten seconds of ninety, takes
 * the network down and taps two doubles: the bout stands at its limit.
 */
async function atTheLimit(page: Page, story: Story) {
  const stub = await openBout(page, {
    rules: rules(story.direction ?? 'normal', story.outcome ?? 'double_loss_zero_scores'),
    phaseType: story.phaseType ?? 'pool',
    row: { status: 'paused', red_score: story.red, blue_score: story.blue },
    clock: { status: 'halted', activeMs: 10_000, startedAt: '2026-01-01T10:00:00.000Z' },
  });
  const chip = page.getByTestId('double-count');
  if (story.phaseType === 'single_elim') {
    // A bracket bout has no doubles limit. The Tournament's rules are read
    // when the one hit button of these rules is the only one.
    await expect(page.getByTestId('clean-hit-button')).toHaveCount(2);
  } else {
    // The Tournament's rules are read: a limit of 2, not the default 4.
    await expect(chip).toContainText('0/2');
  }
  stub.network = 'down';
  await page.getByTestId('double-button').click();
  await page.getByTestId('double-button').click();
  await expect(chip).toContainText(/^\s*2\//);
  return stub;
}

const headline = {
  doubleLoss: (page: Page) => page.getByTestId('match-result-double-loss'),
  draw: (page: Page) => page.getByTestId('match-result-draw'),
  winner: (page: Page) => page.getByTestId('match-result-winner'),
  score: (page: Page) => page.getByTestId('match-result-score'),
};

test('with no network, a level bout at its doubles limit ends as a loss for both', async ({
  page,
}) => {
  const stub = await atTheLimit(page, { red: 0, blue: 0 });

  await page.getByTestId('clock-end-button').click();

  // No question, and no refusal "the time is not finished": the limit is the result.
  await expect(result(page)).toBeVisible();
  await expect(page.getByTestId('end-early-confirm')).toHaveCount(0);
  await expect(headline.doubleLoss(page)).toHaveText('Double loss');
  await expect(headline.draw(page)).toHaveCount(0);
  await expect(headline.winner(page)).toHaveCount(0);
  await expect(headline.score(page)).toHaveText('0 – 0');
  await expect(page.getByTestId('match-result-unconfirmed')).toContainText(/not confirmed/i);
  expect(stub.sent, 'nothing reached the server').toEqual([]);
});

for (const direction of ['normal', 'reverse_zero_loses'] as const) {
  test(`with no network, a bout with a leader (${direction}) at its doubles limit names nobody`, async ({
    page,
  }) => {
    // Red leads 2 – 0 counting up, and 3 – 1 counting down from 3.
    const board = direction === 'normal' ? { red: 2, blue: 0 } : { red: 3, blue: 1 };
    await atTheLimit(page, { direction, ...board });

    await page.getByTestId('clock-end-button').click();

    await expect(result(page)).toBeVisible();
    await expect(page.getByTestId('end-early-confirm')).toHaveCount(0);
    await expect(headline.doubleLoss(page)).toHaveText('Double loss');
    await expect(headline.winner(page)).toHaveCount(0);
    // The board the format leaves, not the board the End was tapped on.
    await expect(headline.score(page)).toHaveText('0 – 0');
  });
}

test('a format that makes the limit a draw reads "Draw", at 0 – 0', async ({ page }) => {
  await atTheLimit(page, { outcome: 'draw_zero_scores', red: 2, blue: 0 });

  await page.getByTestId('clock-end-button').click();

  await expect(headline.draw(page)).toBeVisible();
  await expect(headline.doubleLoss(page)).toHaveCount(0);
  await expect(headline.winner(page)).toHaveCount(0);
  await expect(headline.score(page)).toHaveText('0 – 0');
});

test('a format whose result stands at the limit names the leader, on the board', async ({
  page,
}) => {
  await atTheLimit(page, { outcome: 'result_stands', red: 2, blue: 0 });

  await page.getByTestId('clock-end-button').click();

  // The limit ends the bout there too: no question with time left.
  await expect(result(page)).toBeVisible();
  await expect(page.getByTestId('end-early-confirm')).toHaveCount(0);
  await expect(headline.winner(page)).toContainText('Ana Red');
  await expect(headline.doubleLoss(page)).toHaveCount(0);
  await expect(headline.score(page)).toHaveText('2 – 0');
});

test('a bracket bout has no doubles limit: its End with time left is asked about', async ({
  page,
}) => {
  await atTheLimit(page, { phaseType: 'single_elim', red: 2, blue: 0 });

  await page.getByTestId('clock-end-button').click();

  await expect(page.getByTestId('end-early-confirm')).toBeVisible();
  await expect(result(page)).toHaveCount(0);
});

test('a bout the server ended as a loss for both reads "Double loss", not "Draw"', async ({
  page,
}) => {
  await openBout(page, {
    rules: rules('normal', 'double_loss_zero_scores'),
    row: { status: 'completed', red_score: 0, blue_score: 0, end_reason: 'max_doubles' },
    clock: { status: 'ended', activeMs: 40_000, startedAt: '2026-01-01T10:00:00.000Z' },
  });

  await expect(result(page)).toBeVisible();
  await expect(headline.doubleLoss(page)).toHaveText('Double loss');
  await expect(headline.draw(page)).toHaveCount(0);
  await expect(page.getByTestId('match-result-unconfirmed')).toHaveCount(0);
});

test('a loss for both with a card on its wiped board names nobody', async ({ page }) => {
  // The limit wiped the board and a card took one point off red: -1 and 0,
  // and no winner on the row. The leader of those two numbers has not won.
  await openBout(page, {
    rules: rules('normal', 'double_loss_zero_scores'),
    row: { status: 'completed', red_score: -1, blue_score: 0, end_reason: 'max_doubles' },
    clock: { status: 'ended', activeMs: 40_000, startedAt: '2026-01-01T10:00:00.000Z' },
  });

  await expect(headline.doubleLoss(page)).toHaveText('Double loss');
  await expect(headline.winner(page)).toHaveCount(0);
  await expect(headline.score(page)).toHaveText('-1 – 0');
});
