/**
 * "Can the Fighter continue?" on the pad's forfeit (operator ruling 76, 2026-10-20).
 *
 * The pad asked it on every injury and voluntary withdrawal, in any bout. It now asks only when
 * the reason's rule in the Tournament's penalty ruleset asks (`forfeitAsks` of
 * `GET tournaments/:id/match-config`), and only on a Pool or Swiss bout; on a bracket bout the
 * Fighter continues in the Tournament. When the pad holds no answer of the rules, it asks, and says
 * the rules are not confirmed. The decision itself has its unit tests
 * (`packages/types/src/forfeit-rules.test.ts`).
 *
 * The API is stubbed (`pad-clock-stub.ts`).
 */
import { test, expect, type Page } from '@playwright/test';
import { openBout } from './pad-clock-stub';

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
    pointCap: 5,
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

const question = (page: Page) =>
  page.getByRole('checkbox', { name: 'Fighter can continue in the tournament' });
const unconfirmed = (page: Page) => page.getByTestId('forfeit-rules-unconfirmed');

async function forfeitFor(page: Page, reason: string) {
  await page.locator('#forfeit-reason-match-1').selectOption(reason);
}

async function openDrawer(page: Page, phaseType: string, rules: unknown) {
  await openBout(page, { phaseType, rules });
  await page.getByTestId('open-corrections').click();
  await expect(page.locator('#forfeit-reason-match-1')).toBeVisible();
}

test('a Pool bout asks only for a reason whose rule asks', async ({ page }) => {
  const forfeitAsks = { injury: false, voluntary: true, conduct_violation: false };
  await openDrawer(page, 'pool', { ...RULES, forfeitAsks });

  await forfeitFor(page, 'injury');
  await expect(question(page)).toHaveCount(0);
  await forfeitFor(page, 'voluntary');
  await expect(question(page)).toHaveCount(1);
  await forfeitFor(page, 'conduct_violation');
  await expect(question(page)).toHaveCount(0);
  await expect(unconfirmed(page)).toHaveCount(0);
});

test('a bracket bout never asks: the Fighter continues in the Tournament', async ({ page }) => {
  const forfeitAsks = { injury: true, voluntary: true, conduct_violation: true };
  await openDrawer(page, 'single_elim', { ...RULES, forfeitAsks });

  await forfeitFor(page, 'injury');
  await expect(question(page)).toHaveCount(0);
  await forfeitFor(page, 'voluntary');
  await expect(question(page)).toHaveCount(0);
});

test('a Swiss bout asks when the rule asks', async ({ page }) => {
  const forfeitAsks = { injury: true, voluntary: false, conduct_violation: false };
  await openDrawer(page, 'swiss', { ...RULES, forfeitAsks });

  await forfeitFor(page, 'injury');
  await expect(question(page)).toHaveCount(1);
  await forfeitFor(page, 'voluntary');
  await expect(question(page)).toHaveCount(0);
});

test('rules the pad holds no answer of: it asks, and says they are not confirmed', async ({
  page,
}) => {
  // A server that answered no forfeit questions (its rules could not be read).
  await openDrawer(page, 'pool', { ...RULES, forfeitAsks: null });

  await forfeitFor(page, 'conduct_violation');
  await expect(question(page)).toHaveCount(1);
  await expect(unconfirmed(page)).toBeVisible();
  // A black card's own rule says what it does: never asked.
  await forfeitFor(page, 'black_card_2');
  await expect(question(page)).toHaveCount(0);
  await expect(unconfirmed(page)).toHaveCount(0);
});

test('a config that names no forfeit questions (an older server or copy): it asks, and says so', async ({
  page,
}) => {
  await openDrawer(page, 'pool', RULES);

  await forfeitFor(page, 'injury');
  await expect(question(page)).toHaveCount(1);
  await expect(unconfirmed(page)).toBeVisible();
});
