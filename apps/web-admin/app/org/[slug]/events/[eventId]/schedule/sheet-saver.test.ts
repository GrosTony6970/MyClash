import { describe, expect, it } from 'vitest';
import { createSheetSaver } from './sheet-saver';

/** A fake clock, so the save window can be driven one tick at a time. */
function fakeClock() {
  const timers = new Map<number, () => void>();
  let nextId = 1;
  return {
    setTimer: (fn: () => void) => {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    clearTimer: (id: number) => void timers.delete(id),
    /** Fire every armed timer once. */
    tick(): void {
      const due = [...timers.values()];
      timers.clear();
      for (const fn of due) fn();
    },
    armed: () => timers.size,
  };
}

/** Writes that stay in flight until the test settles them. */
function heldWrites() {
  const calls: Array<{ sheet: number; resolve: () => void; reject: (err: unknown) => void }> = [];
  return {
    calls,
    sent: () => calls.map((c) => c.sheet),
    write: (sheet: number) =>
      new Promise<void>((resolve, reject) => calls.push({ sheet, resolve, reject })),
  };
}

/** Let promise callbacks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const clock = fakeClock();
  const writes = heldWrites();
  const errors: unknown[] = [];
  const saver = createSheetSaver<number>({
    delayMs: 500,
    write: writes.write,
    onError: (err) => void errors.push(err),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { clock, writes, errors, saver };
}

describe('createSheetSaver', () => {
  it('writes nothing when it is built', () => {
    const { clock, writes } = setup();
    expect(clock.armed()).toBe(0);
    expect(writes.sent()).toEqual([]);
  });

  it('sends three quick edits as one write, with the last sheet', () => {
    const { clock, writes, saver } = setup();

    saver.schedule(1);
    saver.schedule(2);
    saver.schedule(3);
    expect(writes.sent()).toEqual([]);
    clock.tick();

    expect(writes.sent()).toEqual([3]);
  });

  it('never runs two writes at once: an edit during a write goes once, after it', async () => {
    const { clock, writes, saver } = setup();

    saver.schedule(1);
    clock.tick();
    saver.schedule(2);
    saver.schedule(3);
    clock.tick();
    // The first write is still in flight, so nothing else has gone.
    expect(writes.sent()).toEqual([1]);

    writes.calls[0]!.resolve();
    await settle();

    expect(writes.sent()).toEqual([1, 3]);
  });

  it('leaves a mid-write edit to its own timer while its window is open', async () => {
    const { clock, writes, saver } = setup();

    saver.schedule(1);
    clock.tick();
    saver.schedule(2);
    writes.calls[0]!.resolve();
    await settle();
    expect(writes.sent()).toEqual([1]);

    clock.tick();
    expect(writes.sent()).toEqual([1, 2]);
  });

  it('flush sends a pending sheet at once and waits for it to settle', async () => {
    const { clock, writes, saver } = setup();
    let flushed = false;

    saver.schedule(7);
    const done = saver.flush().then(() => void (flushed = true));
    expect(writes.sent()).toEqual([7]);
    expect(clock.armed()).toBe(0);
    await settle();
    expect(flushed).toBe(false);

    writes.calls[0]!.resolve();
    await done;
    expect(flushed).toBe(true);
  });

  it('hands a refused write to onError and keeps saving', async () => {
    const { clock, writes, errors, saver } = setup();
    const refusal = new Error('400');

    saver.schedule(1);
    clock.tick();
    writes.calls[0]!.reject(refusal);
    await settle();
    expect(errors).toEqual([refusal]);

    saver.schedule(2);
    clock.tick();
    expect(writes.sent()).toEqual([1, 2]);
  });
});
