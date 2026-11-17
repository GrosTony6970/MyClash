/**
 * Past the Tournament's protest limit, a protest is recorded at the tap, then
 * the pad offers the penalty the organiser chose, naming the Fighter, the
 * penalty and the card it would really give. "No" changes nothing. "Yes" gives
 * that card at once: the offer is the question, so a red card asks no second
 * one. The chip shows `count/limit`, in the warning colour from the limit on.
 * The break screens take no card, so they count and warn and offer nothing.
 *
 * The API is stubbed (`pad-penalty-stub.ts`, a running bout, and
 * `pad-rounds-stub.ts`, a best-of-3 bout). Both answer the Tournament's
 * `/match-config` with a limit of 2 and the penalty of ref '8'. The penalty
 * list sends its refs as text, as the API does. The offer itself has the unit
 * tests (`lib/protest-offer.test.ts`).
 */
import { test, expect, type Page } from '@playwright/test';
import { dialog, openProtestBout, protestChip } from './pad-penalty-stub';
import { openBestOf, plusTwo, roundBreak, startAndHalt } from './pad-rounds-stub';

const PROTESTS = { limit: 2, offerPenaltyRef: '8' };

/** The Tournament's rules as `/match-config` gives them, with its protest limit. */
const MATCH_CONFIG = {
  scoringConfig: {
    afterblowMode: 'deductive',
    buttons: {
      clean: [
        { label: '+2', value: 2, visible: true },
        { label: '+1', value: 1, visible: true },
      ],
      afterblow: [],
    },
    display: { sideColors: { red: 'red', blue: 'blue' }, quickPenalties: [], protests: PROTESTS },
  },
  matchFormat: {
    pointCap: 10,
    scoringDirection: 'normal',
    timerMode: 'countdown',
    timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 },
    softClockLimitSeconds: 5,
    maxDoubleHits: 4,
    maxDoubleHitOutcome: 'double_loss_zero_scores',
    bestOf: { pool: 1, bracket: 1, finals: 1 },
    levelAtTime: {
      pool: [{ kind: 'draw' }],
      bracket: [{ kind: 'sudden_death' }],
      finals: [{ kind: 'sudden_death' }],
    },
  },
};

/** The penalty list, its refs as text: '8' is the penalty the organiser chose, a red card. */
const PENALTY_LIST = {
  id: 'list-1',
  name: 'House list',
  accumulation_scope: 'match',
  penalty_ruleset_entries: [
    {
      id: 'entry-late',
      group_number: 1,
      ref_number: '1',
      short_name: 'Late on guard',
      description: 'Late on guard, in full',
      sanctions: ['yellow'],
    },
    {
      id: 'entry-abuse',
      group_number: 8,
      ref_number: '8',
      short_name: 'Contestation abusive',
      description: 'Contestation abusive, in full',
      sanctions: ['red'],
    },
  ],
};

/** Taps a Fighter's protest and waits until the chip counts it. */
async function tapProtest(page: Page, count: number) {
  await protestChip(page, 'red').click();
  await expect(protestChip(page, 'red')).toHaveAttribute('data-count', String(count));
}

test('past the limit, the pad offers the chosen penalty: No gives nothing, Yes gives the card at once', async ({
  page,
}) => {
  const stub = await openProtestBout(page, {
    rules: { matchConfig: MATCH_CONFIG, penaltyList: PENALTY_LIST },
  });
  const chip = protestChip(page, 'red');
  await expect(chip).toHaveText('0/2');
  await expect(chip).not.toHaveClass(/bg-warning\/15/);

  await tapProtest(page, 1);
  await tapProtest(page, 2);
  // At the limit: the chip warns, and no question was asked (the next tap could not land under one).
  await expect(chip).toHaveText('2/2');
  await expect(chip).toHaveClass(/bg-warning\/15/);

  await tapProtest(page, 3);
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText('Protest limit passed');
  await expect(dialog(page)).toContainText('Give Contestation abusive (Red) to Ana Red?');

  // No: the protest stays, and nothing else is sent.
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(chip).toHaveText('3/2');
  await expect(chip).toHaveClass(/bg-warning\/15/);
  await expect(chip).toHaveClass(/text-warning/);
  await expect(chip).toHaveClass(/border-warning/);
  await expect
    .poll(() => stub.sent)
    .toEqual(['POST /protests', 'POST /protests', 'POST /protests']);

  // A fourth protest offers again; Yes gives the card, with no second question for a red card.
  await tapProtest(page, 4);
  await expect(dialog(page)).toContainText('Give Contestation abusive (Red) to Ana Red?');
  await dialog(page).getByTestId('ask-first-confirm').click();
  await expect(dialog(page)).toHaveCount(0);

  // The bout's writes end with the one known call: four protests, then the one card.
  await expect
    .poll(() => stub.sent)
    .toEqual([
      'POST /protests',
      'POST /protests',
      'POST /protests',
      'POST /protests',
      'POST /penalties',
    ]);
  expect(stub.cards).toEqual(['entry-abuse']);
  await expect(dialog(page)).toHaveCount(0);
});

test('on the round-break screen, a protest past the limit is recorded and warns, and offers nothing', async ({
  page,
}) => {
  const stub = await openBestOf(page, { protestRules: PROTESTS });
  await startAndHalt(page);
  await plusTwo(page, 'red').click();
  await expect(roundBreak(page)).toContainText(/round 1 complete/i);
  const red = roundBreak(page).getByRole('button', { name: /Record a protest by Ana Red/ });
  await expect(red).toHaveAccessibleName('Record a protest by Ana Red (0/2 so far)');

  for (const count of [1, 2, 3]) {
    await red.click();
    await expect(red).toHaveAttribute('data-count', String(count));
  }

  await expect(red).toContainText('3/2');
  await expect(red).toHaveClass(/bg-warning\/15/);
  await expect.poll(() => stub.sent.filter((call) => call === 'POST /protests')).toHaveLength(3);
  // The one dialog is the round break itself: no offer opened over it.
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(roundBreak(page)).toContainText(/round 1 complete/i);
  await expect(page.getByText('Protest limit passed')).toHaveCount(0);
  expect(stub.sent).toEqual([
    'POST /clock start',
    'POST /clock halt',
    'POST /exchanges',
    'POST /protests',
    'POST /protests',
    'POST /protests',
  ]);
});
