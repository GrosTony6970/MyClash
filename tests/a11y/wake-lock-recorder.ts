/**
 * A test cannot make a screen sleep. The browser's wake lock is replaced by a
 * record of what the page asked of it. The rules of the lock have their unit
 * tests (`packages/ui`, `wake-lock.test.ts`).
 */
import type { Page } from '@playwright/test';

interface Wake {
  asked: string[];
  givenBack: number;
}

/** Before the page loads: the wake lock writes down what it is asked. */
export async function recordWakeLock(page: Page) {
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
 * is held. So a story counts what is HELD, not what was asked.
 */
export const wake = (page: Page) =>
  page.evaluate(() => {
    const { asked, givenBack } = (window as unknown as { padWake: Wake }).padWake;
    return { held: asked.length - givenBack, kinds: [...new Set(asked)] };
  });
