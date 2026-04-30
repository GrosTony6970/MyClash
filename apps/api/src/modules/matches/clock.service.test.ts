import { describe, it, expect } from 'vitest';
import { ClockService } from './clock.service';

// ── Tests for computeClockState (pure function) ───────────────────────────────

describe('ClockService.computeClockState', () => {
  // We test the pure computeClockState method directly — no DB needed.
  const service = new ClockService(null as never);

  const T0 = '2026-04-25T09:00:00.000Z'; // 09:00:00
  const T1 = '2026-04-25T09:03:00.000Z'; // +3 min
  const T2 = '2026-04-25T09:05:00.000Z'; // +5 min
  const T3 = '2026-04-25T09:08:00.000Z'; // +8 min
  const T4 = '2026-04-25T09:10:00.000Z'; // +10 min

  it('idle state when no events', () => {
    const state = service.computeClockState('m1', []);
    expect(state.status).toBe('idle');
    expect(state.activeMs).toBe(0);
    expect(state.runningFrom).toBeNull();
  });

  it('running state after start', () => {
    const state = service.computeClockState('m1', [
      { id: 'e1', type: 'start', reason: null, occurred_at: T0 },
    ]);
    expect(state.status).toBe('running');
    expect(state.activeMs).toBe(0); // no closed intervals yet
    expect(state.runningFrom).toBe(T0);
  });

  it('halted state after start + halt, activeMs = elapsed', () => {
    const state = service.computeClockState('m1', [
      { id: 'e1', type: 'start', reason: null, occurred_at: T0 },
      { id: 'e2', type: 'halt', reason: null, occurred_at: T1 },
    ]);
    expect(state.status).toBe('halted');
    expect(state.activeMs).toBe(3 * 60 * 1000); // 3 minutes
    expect(state.runningFrom).toBeNull();
  });

  it('running again after resume, accumulates previous interval', () => {
    const state = service.computeClockState('m1', [
      { id: 'e1', type: 'start', reason: null, occurred_at: T0 },
      { id: 'e2', type: 'halt', reason: null, occurred_at: T1 }, // +3 min
      { id: 'e3', type: 'resume', reason: null, occurred_at: T2 }, // resume at +5 min
    ]);
    expect(state.status).toBe('running');
    expect(state.activeMs).toBe(3 * 60 * 1000); // 3 min from first interval
    expect(state.runningFrom).toBe(T2);
  });

  it('ended state accumulates all intervals', () => {
    const state = service.computeClockState('m1', [
      { id: 'e1', type: 'start', reason: null, occurred_at: T0 },
      { id: 'e2', type: 'halt', reason: null, occurred_at: T1 }, // 3 min
      { id: 'e3', type: 'resume', reason: null, occurred_at: T2 }, // resume
      { id: 'e4', type: 'end', reason: null, occurred_at: T3 }, // +3 more min
    ]);
    expect(state.status).toBe('ended');
    // 3 min (T0→T1) + 3 min (T2→T3) = 6 min
    expect(state.activeMs).toBe(6 * 60 * 1000);
    expect(state.runningFrom).toBeNull();
  });

  it('reset_clock clears accumulated time', () => {
    const state = service.computeClockState('m1', [
      { id: 'e1', type: 'start', reason: null, occurred_at: T0 },
      { id: 'e2', type: 'halt', reason: null, occurred_at: T1 }, // 3 min
      { id: 'e3', type: 'reset_clock', reason: null, occurred_at: T2 }, // reset
    ]);
    expect(state.status).toBe('halted');
    expect(state.activeMs).toBe(0); // reset clears everything
    expect(state.runningFrom).toBeNull();
  });

  it('multiple halt/resume cycles accumulate correctly', () => {
    const state = service.computeClockState('m1', [
      { id: 'e1', type: 'start', reason: null, occurred_at: T0 },
      { id: 'e2', type: 'halt', reason: null, occurred_at: T1 }, // 3 min
      { id: 'e3', type: 'resume', reason: null, occurred_at: T2 }, // resume at 5 min
      { id: 'e4', type: 'halt', reason: null, occurred_at: T3 }, // +3 min = 6 min total
      { id: 'e5', type: 'resume', reason: null, occurred_at: T4 }, // resume at 10 min
    ]);
    expect(state.status).toBe('running');
    expect(state.activeMs).toBe(6 * 60 * 1000); // 3+3 min
    expect(state.runningFrom).toBe(T4);
  });

  // ── AC: reload preserves clock state ─────────────────────────────────────
  it('same events always produce same state (deterministic / reload-safe)', () => {
    const events = [
      { id: 'e1', type: 'start', reason: null, occurred_at: T0 },
      { id: 'e2', type: 'halt', reason: null, occurred_at: T1 },
    ];
    const s1 = service.computeClockState('m1', events);
    const s2 = service.computeClockState('m1', events);
    expect(s1).toEqual(s2);
  });

  // ── AC: drift correction ──────────────────────────────────────────────────
  it('totalActiveMs > activeMs when running (includes current interval)', () => {
    const state = service.computeClockState('m1', [
      { id: 'e1', type: 'start', reason: null, occurred_at: T0 },
    ]);
    // totalActiveMs should be > 0 since T0 is in the past
    expect(state.totalActiveMs).toBeGreaterThan(0);
    expect(state.totalActiveMs).toBeGreaterThanOrEqual(state.activeMs);
  });

  it('totalActiveMs === activeMs when halted (no current interval)', () => {
    const state = service.computeClockState('m1', [
      { id: 'e1', type: 'start', reason: null, occurred_at: T0 },
      { id: 'e2', type: 'halt', reason: null, occurred_at: T1 },
    ]);
    expect(state.totalActiveMs).toBe(state.activeMs);
  });
});
