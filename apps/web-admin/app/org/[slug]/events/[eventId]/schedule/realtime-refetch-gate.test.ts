import { describe, expect, it } from 'vitest';
import { createRefetchGate } from './realtime-refetch-gate';

/**
 * A fake clock, so the gate can be driven a window at a time.
 *
 * Injecting the timer functions rather than mocking globals is what makes this
 * testable at all: the gate is the only part of the realtime path that decides
 * anything, and the drag specs cannot reach it — they run against a dead
 * Supabase URL, so no realtime event is ever delivered to them.
 */
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
    /** Fire every armed timer once, in arm order. */
    tick(): void {
      const due = [...timers.entries()];
      timers.clear();
      for (const [, fn] of due) fn();
    },
    armed: () => timers.size,
  };
}

describe('createRefetchGate', () => {
  it('collapses a burst of events into one refetch', () => {
    const clock = fakeClock();
    let refetches = 0;
    const gate = createRefetchGate({
      delayMs: 1500,
      isBusy: () => false,
      refetch: () => void refetches++,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });

    gate.schedule();
    gate.schedule();
    gate.schedule();
    clock.tick();

    expect(refetches).toBe(1);
  });

  it('holds the refetch off while a write is in flight, then runs it', () => {
    // The defect this exists for. A suppressed tick used to be dropped, and
    // nothing re-read the board afterwards: the fallback poll only runs while
    // the websocket is down, and a successful write never refetches. The
    // operator was left working from a stale board.
    const clock = fakeClock();
    let refetches = 0;
    let busy = true;
    const gate = createRefetchGate({
      delayMs: 1500,
      isBusy: () => busy,
      refetch: () => void refetches++,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });

    gate.schedule();
    clock.tick();
    expect(refetches).toBe(0);
    // Still armed — the tick was deferred, not discarded.
    expect(clock.armed()).toBe(1);

    busy = false;
    clock.tick();
    expect(refetches).toBe(1);
  });

  it('reads the busy flag when the timer fires, not when it is armed', () => {
    // A drag that starts a write after the tick is armed still has to suppress
    // it, which is why the flag is a function rather than a value.
    const clock = fakeClock();
    let refetches = 0;
    let busy = false;
    const gate = createRefetchGate({
      delayMs: 1500,
      isBusy: () => busy,
      refetch: () => void refetches++,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });

    gate.schedule();
    busy = true;
    clock.tick();

    expect(refetches).toBe(0);
  });

  it('drops a pending refetch when the board goes away', () => {
    // The pending timer used to outlive the component and fire a request into
    // an unmounted tree. Nothing surfaced it — the setters no-op after unmount
    // — but the request still went out.
    const clock = fakeClock();
    let refetches = 0;
    const gate = createRefetchGate({
      delayMs: 1500,
      isBusy: () => false,
      refetch: () => void refetches++,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });

    gate.schedule();
    gate.cancel();
    clock.tick();

    expect(refetches).toBe(0);
    expect(clock.armed()).toBe(0);
  });

  it('cancels a refetch that was deferred by a write', () => {
    // Rearming must not resurrect a gate the caller has cancelled.
    const clock = fakeClock();
    let refetches = 0;
    const gate = createRefetchGate({
      delayMs: 1500,
      isBusy: () => true,
      refetch: () => void refetches++,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });

    gate.schedule();
    clock.tick();
    gate.cancel();
    clock.tick();

    expect(refetches).toBe(0);
    expect(clock.armed()).toBe(0);
  });
});
