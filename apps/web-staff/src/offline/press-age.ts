/**
 * How old a clock press is when the tablet sends it.
 *
 * The server never reads the time of day a tablet says: it reads only how long
 * ago the press was made (`sentAt - pressedAt`), and takes that off its own
 * clock. So the tablet must measure that length well, and a tablet has no
 * clock that is right in every case:
 *
 *   - The time of day (`Date.now()`) keeps running while the tablet sleeps and
 *     across a reload. It JUMPS when the tablet corrects it: a tablet set an
 *     hour wrong by hand, then corrected by the network at reconnect.
 *   - The page's own clock (`performance.now()`) never jumps. On some tablets
 *     it STOPS while the tablet sleeps, and it starts again from zero at each
 *     reload.
 *
 * The age is the LARGER of the two. A time of day corrected backwards, a sleep
 * and a reload each make one clock read too little, and the other is right.
 * Two cases are left, both between the press and the send:
 *
 *   - A time of day corrected FORWARDS makes the press too old by that
 *     correction. By more than a day, the server refuses it as too old.
 *   - A time of day corrected BACKWARDS on a page that was also reloaded (or
 *     whose clock stopped in a sleep) leaves no clock that is right: the age
 *     reads too little, down to zero, and the press is placed too late.
 *
 * Pure: the caller gives the tablet's two clocks.
 */

/** The tablet's two clocks, read at one moment. */
export interface TabletTime {
  /** The time of day (ms). */
  wall: number;
  /** The page's own clock (ms since the page opened). */
  page: number;
  /** Which page that clock belongs to: it differs after a reload. */
  origin: number;
}

export const tabletTime = (): TabletTime => ({
  wall: Date.now(),
  page: performance.now(),
  origin: performance.timeOrigin,
});

/** What a queued press holds of the moment it was made. */
export interface PressMoment {
  /** The tablet's time of day at the tap (ISO). */
  occurredAt: string;
  pressedPerf?: number;
  pressOrigin?: number;
}

/**
 * How long ago the press was made (ms). Never under zero: the page's clock
 * reads zero when it cannot be used, and it never runs backwards.
 */
export function pressAgeMs(press: PressMoment, now: TabletTime): number {
  const byWall = now.wall - Date.parse(press.occurredAt);
  const samePage = press.pressOrigin === now.origin && press.pressedPerf !== undefined;
  const byPage = samePage ? now.page - (press.pressedPerf as number) : 0;
  return Math.max(Number.isFinite(byWall) ? byWall : 0, byPage);
}

/**
 * The two times a late press carries to the server. `pressedAt` is the row's
 * own time; `sentAt` is that time plus the age, so the server reads the age
 * and nothing else.
 */
export function pressTimes(
  press: PressMoment,
  now: TabletTime,
): { pressedAt: string; sentAt: string } {
  const pressedMs = Date.parse(press.occurredAt);
  const base = Number.isFinite(pressedMs) ? pressedMs : now.wall;
  return {
    pressedAt: new Date(base).toISOString(),
    sentAt: new Date(base + pressAgeMs(press, now)).toISOString(),
  };
}
