/**
 * The tablet does not sleep while a bout is on its screen (quick win P7).
 *
 * A tablet at a piste went to sleep during a bout, and the official unlocked
 * it while two fighters waited. The bout screen now asks the browser to keep
 * the screen awake, and gives the lock back when the official leaves the bout.
 *
 * A test cannot make a tablet sleep. The browser's wake lock is replaced by a
 * record of what the page asked of it. The API is stubbed (`pad-clock-stub.ts`).
 * The rules of the lock have their unit tests (`packages/ui`, `wake-lock.test.ts`).
 */
import { test, expect, type Page } from '@playwright/test';
import { openBout } from './pad-clock-stub';

interface Wake {
  asked: string[];
  givenBack: number;
}

/** Before the page loads: the wake lock writes down what it is asked. */
async function recordWakeLock(page: Page) {
  await page.addInitScript(() => {
    const wake: Wake = { asked: [], givenBack: 0 };
    (window as unknown as { padWake: Wake }).padWake = wake;
    Object.defineProperty(Navigator.prototype, 'wakeLock', {
      configurable: true,
      get: () => ({
        request(type: string) {
          wake.asked.push(type);
          return Promise.resolve({
            release() {
              wake.givenBack += 1;
              return Promise.resolve();
            },
            addEventListener() {},
          });
        },
      }),
    });
  });
}

/**
 * The locks the page holds now, and what it asked for. A dev build mounts a
 * screen twice (React's strict mode): the first lock is given back, the second
 * is held. So the story counts what is HELD, not what was asked.
 */
const wake = (page: Page) =>
  page.evaluate(() => {
    const { asked, givenBack } = (window as unknown as { padWake: Wake }).padWake;
    return { held: asked.length - givenBack, kinds: [...new Set(asked)] };
  });

test('the bout screen keeps the tablet awake, and gives the lock back when it is left', async ({
  page,
}) => {
  await recordWakeLock(page);
  await openBout(page);

  await expect.poll(() => wake(page)).toEqual({ held: 1, kinds: ['screen'] });

  // Back to the list: the same page of the browser, without the bout screen.
  await page
    .locator('header')
    .getByRole('link', { name: /back to match list/i })
    .click();
  await expect(page.getByTestId('clock-primary-button')).toHaveCount(0);

  await expect.poll(() => wake(page)).toEqual({ held: 0, kinds: ['screen'] });
});
