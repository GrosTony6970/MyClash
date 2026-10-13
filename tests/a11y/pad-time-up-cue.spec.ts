/**
 * The tablet beeps and vibrates when time is up, and gives a short pulse when
 * a hit is written (quick win P13; operator, 2026-10-12).
 *
 * At 0:00 the numeral turned red and nothing else happened: the official had
 * to watch the tablet, not the fighters. Now each time a RUNNING clock crosses
 * 0:00 the tablet gives two pulses and a beep: at the end of regulation, and
 * again at the end of extra time. A screen opened on a bout already past its
 * time gives none.
 *
 * A test cannot hear or feel a tablet. The browser's vibration and its sound
 * are replaced by a record of what the page asked of them. The API is stubbed
 * (`pad-clock-stub.ts`); the stories give 2 seconds of extra time.
 */
import { test, expect, type Page } from '@playwright/test';
import { levelStep, openBout, primary, redHit, status } from './pad-clock-stub';

interface Cues {
  vibrations: unknown[];
  beeps: number;
}

/** Before the page loads: the vibration and the sound write down what they are asked. */
async function recordCues(page: Page) {
  await page.addInitScript(() => {
    const cues: Cues = { vibrations: [], beeps: 0 };
    (window as unknown as { padCues: Cues }).padCues = cues;
    Navigator.prototype.vibrate = function (pattern: VibratePattern) {
      cues.vibrations.push(pattern);
      return true;
    };
    class RecordedSound {
      currentTime = 0;
      destination = {};
      resume() {
        return Promise.resolve();
      }
      createOscillator() {
        return {
          frequency: { value: 0 },
          connect() {},
          start() {
            cues.beeps += 1;
          },
          stop() {},
        };
      }
      createGain() {
        return { gain: { value: 0 }, connect() {} };
      }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = RecordedSound;
  });
}

const cues = (page: Page) => page.evaluate(() => (window as unknown as { padCues: Cues }).padCues);
const TIME_UP = [200, 100, 200];

/** 90 seconds; a level bracket bout plays 2 s of extra time, then sudden death. */
const rules = {
  scoringConfig: {
    afterblowMode: 'full',
    buttons: { clean: [{ label: '+1', value: 1, visible: true }], afterblow: [] },
    display: { sideColors: { red: 'red', blue: 'blue' } },
  },
  matchFormat: {
    pointCap: 10,
    scoringDirection: 'normal',
    timerMode: 'countdown',
    timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 },
    // No soft zone: a Resume with 1 second left is not asked about.
    softClockLimitSeconds: 0,
    maxDoubleHits: null,
    maxDoubleHitOutcome: 'double_loss_zero_scores',
    bestOf: { pool: 1, bracket: 1, finals: 1 },
    levelAtTime: {
      pool: [{ kind: 'draw' }],
      bracket: [{ kind: 'extra_time', seconds: 2 }, { kind: 'sudden_death' }],
      finals: [{ kind: 'sudden_death' }],
    },
  },
};
const STARTED = '2026-01-01T10:00:00.000Z';
/** A bracket bout, level at 3 - 3. */
const bout = { phaseType: 'single_elim', rules, afterExtraTimeMs: 88_000 };

test('the tablet beeps and vibrates when the clock crosses 0:00, and again at the end of extra time', async ({
  page,
}) => {
  await recordCues(page);
  // Paused with one second left.
  await openBout(page, {
    ...bout,
    row: { status: 'paused', red_score: 3, blue_score: 3 },
    clock: { status: 'halted', activeMs: 89_000, startedAt: STARTED },
  });
  await expect(status(page)).toHaveAttribute('data-status', 'halted');
  // The Tournament's rules are read: its one hit button a side, not the
  // default two. Before, a Resume with one second left is asked about (the
  // default rules have a soft zone), and the clock does not run: red once in
  // CI, 2026-10-13, where the page showed the "Time is up" question.
  await expect(page.getByTestId('clean-hit-button')).toHaveCount(2);
  expect(await cues(page)).toEqual({ vibrations: [], beeps: 0 });

  await primary(page).click();
  await expect.poll(() => cues(page)).toEqual({ vibrations: [TIME_UP], beeps: 1 });

  // Extra time: 2 seconds are put back on the clock, and they run out.
  await expect(levelStep(page)).toHaveAttribute('data-remedy', 'extra_time');
  await levelStep(page).click();
  await expect(status(page)).toHaveAttribute('data-status', 'halted');
  await primary(page).click();
  await expect(levelStep(page)).toHaveAttribute('data-remedy', 'sudden_death');

  // Twice in all: one for each 0:00, and none for the time spent past it.
  await expect.poll(() => cues(page)).toEqual({ vibrations: [TIME_UP, TIME_UP], beeps: 2 });
});

test('a screen opened on a bout past its time gives no cue, and a hit gives one short pulse', async ({
  page,
}) => {
  await recordCues(page);
  // The clock runs, 5 seconds past its 90.
  await openBout(page, {
    ...bout,
    row: { status: 'running', red_score: 3, blue_score: 3 },
    clock: {
      status: 'running',
      activeMs: 95_000,
      runningFrom: new Date().toISOString(),
      startedAt: STARTED,
    },
  });
  await expect(status(page)).toHaveAttribute('data-status', 'running');

  // The official pauses, and gives a hit. Its pulse is the first and only cue.
  await primary(page).click();
  await expect(status(page)).toHaveAttribute('data-status', 'halted');
  await redHit(page).click();
  await expect.poll(() => cues(page)).toEqual({ vibrations: [10], beeps: 0 });
});
