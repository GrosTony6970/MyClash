/**
 * A quick-pick penalty is pinned by its ref, and a ref is TEXT (`"8"`, `"R7a"`,
 * migration 0071). The Tournament's `display.quickPenalties` holds refs as text,
 * so the pad matches them as text: the chip of `R7a` shows, and one tap gives
 * that card. The list is sorted as a person reads it: `2` before `10`, the
 * letter ref after the numbers.
 *
 * The API is stubbed (`pad-penalty-stub.ts`), and the stub serves the Tournament's
 * config straight. So the server's old drop of a text ref is held by the API unit
 * test (`tournament-config.test.ts`), not here. The chip check below is a
 * regression guard: it passed on the old pad. Only the sort check was red there.
 * The matching, the sort and the search have their unit tests
 * (`lib/penalty-entries.test.ts`).
 */
import { test, expect } from '@playwright/test';
import { openProtestBout } from './pad-penalty-stub';

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
    display: { sideColors: { red: 'red', blue: 'blue' }, quickPenalties: ['R7a'] },
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

const entry = (id: string, ref: string, name: string) => ({
  id,
  group_number: 1,
  ref_number: ref,
  short_name: name,
  description: `${name}, in full`,
  sanctions: ['yellow'],
});
/** Listed out of order, refs as text. */
const PENALTY_LIST = {
  id: 'list-1',
  name: 'House list',
  accumulation_scope: 'match',
  penalty_ruleset_entries: [
    entry('entry-ten', '10', 'Tenth'),
    entry('entry-r7a', 'R7a', 'Rude'),
    entry('entry-two', '2', 'Second'),
  ],
};

test('the quick chip of a ref that is text shows, gives its card, and the list sorts 2 before 10', async ({
  page,
}) => {
  const stub = await openProtestBout(page, {
    rules: { matchConfig: MATCH_CONFIG, penaltyList: PENALTY_LIST },
  });
  const red = page.locator('[data-side="red"]');
  const chips = red.getByTestId('quick-penalty-button');

  await expect(chips).toHaveCount(1);
  await expect(chips).toHaveAttribute('data-entry-id', 'entry-r7a');

  const rows = red.getByTestId('penalty-entry-button');
  await expect(rows).toHaveCount(3);
  await expect(rows).toHaveText([/^2\. Second/, /^10\. Tenth/, /^R7a\. Rude/]);

  await chips.click();
  await expect.poll(() => stub.cards).toEqual(['entry-r7a']);
});
