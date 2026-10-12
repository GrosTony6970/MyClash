'use client';

import { useEffect, useRef } from 'react';
import { timeUpCue } from '../lib/pad-cue';
import { crossedLimit, type ClockReading } from '../lib/time-up';

/**
 * The beep and the vibration of "time is up" (quick win P13), from the live
 * time of the one component that ticks. The rule is `crossedLimit`; this keeps
 * the reading of the draw before, which is all the rule needs.
 *
 * A ref, not a state: the reading before is not drawn. It is empty when the
 * screen opens, so a bout opened past its time crosses nothing here.
 */
export function useTimeUpCue(
  status: ClockReading['status'],
  elapsedMs: number,
  limitMs: number | null,
): void {
  const before = useRef<ClockReading | null>(null);
  useEffect(() => {
    const crossed = crossedLimit(before.current, elapsedMs, limitMs);
    before.current = { status, elapsedMs };
    if (crossed) timeUpCue();
  }, [status, elapsedMs, limitMs]);
}
