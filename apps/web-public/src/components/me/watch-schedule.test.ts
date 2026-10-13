import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleRead } from './read-my-schedule';
import type { ScheduleAnswer } from './schedule-state';
import { SCHEDULE_READ_LIMIT_MS, SCHEDULE_REREAD_MS, watchSchedule } from './watch-schedule';

/**
 * When a schedule page reads, and what it does with an answer that comes late
 * (quick win F10). The rules of `watchSchedule`, run with a clock the test
 * moves and reads the test answers by hand.
 */
type Paul = { personId: string };
const PAUL: ScheduleRead<Paul> = { kind: 'data', data: { personId: 'paul' } };

/** A page in a browser: a window and a document that take listeners. */
function browser(visibility: 'visible' | 'hidden' = 'visible') {
  const page = Object.assign(new EventTarget(), { visibilityState: visibility });
  const win = new EventTarget();
  vi.stubGlobal('document', page);
  vi.stubGlobal('window', win);
  return {
    comesBack: () => {
      page.visibilityState = 'visible';
      page.dispatchEvent(new Event('visibilitychange'));
    },
    isHidden: () => {
      page.visibilityState = 'hidden';
      page.dispatchEvent(new Event('visibilitychange'));
    },
    signalReturns: () => win.dispatchEvent(new Event('online')),
  };
}

/** The server: each read waits until the test answers it, or until its signal ends it. */
function server() {
  const asked: { signal: AbortSignal; answer: (read: ScheduleRead<Paul>) => void }[] = [];
  const readOnce = (signal: AbortSignal) =>
    new Promise<ScheduleRead<Paul>>((resolve) => {
      signal.addEventListener('abort', () => resolve({ kind: 'aborted' }));
      asked.push({ signal, answer: resolve });
    });
  return { asked, readOnce };
}

function watching(visibility?: 'visible' | 'hidden') {
  const page = browser(visibility);
  const api = server();
  const taken: ScheduleAnswer<Paul>[] = [];
  const end = watchSchedule<Paul>(api.readOnce, (answer) => taken.push(answer));
  return { page, asked: api.asked, taken, end };
}

/** Lets an answered read reach `take`. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('when a schedule page reads', () => {
  it('at once, and hands the answer over', async () => {
    const { asked, taken } = watching();
    expect(asked).toHaveLength(1);

    asked[0].answer(PAUL);
    await settle();
    expect(taken).toEqual([PAUL]);
  });

  it('again once a minute while the page is in view', async () => {
    const { asked } = watching();
    asked[0].answer(PAUL);
    await settle();

    await vi.advanceTimersByTimeAsync(SCHEDULE_REREAD_MS - 1);
    expect(asked).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(asked).toHaveLength(2);
  });

  it('not behind a page that is out of view, and again when the visitor comes back', async () => {
    const { asked, page } = watching();
    asked[0].answer(PAUL);
    await settle();

    page.isHidden();
    await vi.advanceTimersByTimeAsync(SCHEDULE_REREAD_MS * 3);
    expect(asked).toHaveLength(1);

    page.comesBack();
    expect(asked).toHaveLength(2);
  });

  it('again when the signal returns', async () => {
    const { asked, page } = watching();
    asked[0].answer({ kind: 'failed' });
    await settle();

    page.signalReturns();
    expect(asked).toHaveLength(2);
  });
});

describe('one read at a time', () => {
  it('a tick, the signal and a return to the page ask nothing while a read is out', async () => {
    const { asked, page, taken } = watching();
    asked[0].answer({ kind: 'failed' });
    await settle();

    // A read goes out one second before the minute's tick.
    await vi.advanceTimersByTimeAsync(SCHEDULE_REREAD_MS - 1_000);
    page.signalReturns();
    expect(asked).toHaveLength(2);

    page.signalReturns();
    page.comesBack();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(asked).toHaveLength(2);

    // The read that was out is the one whose answer is taken: none was dropped for a newer ask.
    asked[1].answer(PAUL);
    await settle();
    expect(taken).toEqual([{ kind: 'failed' }, PAUL]);
    page.signalReturns();
    expect(asked).toHaveLength(3);
  });
});

describe('a read with no answer', () => {
  it('is ended after its limit and counts as a failed read', async () => {
    const { asked, taken } = watching();

    await vi.advanceTimersByTimeAsync(SCHEDULE_READ_LIMIT_MS - 1);
    expect(asked[0].signal.aborted).toBe(false);
    expect(taken).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(asked[0].signal.aborted).toBe(true);
    expect(taken).toEqual([{ kind: 'failed' }]);
  });

  it('leaves room for the next one', async () => {
    const { asked, page } = watching();
    await vi.advanceTimersByTimeAsync(SCHEDULE_READ_LIMIT_MS);

    page.signalReturns();
    expect(asked).toHaveLength(2);
  });

  it('an answer in time is not ended by the limit later', async () => {
    const { asked, taken } = watching();
    asked[0].answer(PAUL);
    await settle();

    await vi.advanceTimersByTimeAsync(SCHEDULE_READ_LIMIT_MS);
    expect(asked[0].signal.aborted).toBe(false);
    expect(taken).toEqual([PAUL]);
  });
});

describe('a page that left', () => {
  it('ends the read that is out, and takes nothing from it', async () => {
    const { asked, taken, end } = watching();

    end();
    expect(asked[0].signal.aborted).toBe(true);
    await settle();
    expect(taken).toEqual([]);
  });

  it('takes nothing from an answer that was already on its way', async () => {
    const { asked, taken, end } = watching();

    asked[0].answer(PAUL);
    end();
    await settle();
    expect(taken).toEqual([]);
  });

  it('reads no more: no tick, no signal, no return to the page', async () => {
    const { asked, page, end } = watching();
    asked[0].answer(PAUL);
    await settle();

    end();
    page.signalReturns();
    page.comesBack();
    await vi.advanceTimersByTimeAsync(SCHEDULE_REREAD_MS * 2);
    expect(asked).toHaveLength(1);
  });
});
