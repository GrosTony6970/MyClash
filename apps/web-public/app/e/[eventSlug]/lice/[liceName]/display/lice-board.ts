import { apiRequest } from '@myclash/api-client';
import {
  LIVE_POLL_MS,
  boutIsOver,
  livePollMs,
  readLiveMatch,
  type LiceWaitingDisplayNextMatch,
} from '@myclash/ui';
import { getPublicApiUrl } from '../../../../../../src/lib/api-url';

/** What the piste screen shows: the bout it hands to `DisplayView`, or its waiting card. */
export interface LiceBoard {
  liceId: string | null;
  matchId: string | null;
  eventName: string | null;
  nextMatch: LiceWaitingDisplayNextMatch | null;
  /** The board's Event hides something from the public, so the screen polls it (ruling 92). */
  hiddenFromPublic: boolean;
}

export const EMPTY_BOARD: LiceBoard = {
  liceId: null,
  matchId: null,
  eventName: null,
  nextMatch: null,
  hiddenFromPublic: false,
};

/** The address of a piste's own TV screen, for the piste switcher. */
export function liceDisplayHref(eventSlug: string, liceName: string): string {
  return `/e/${eventSlug}/lice/${encodeURIComponent(liceName)}/display`;
}

interface CurrentBody {
  liceId: string;
  liceName: string;
  event: { name?: string | null } | null;
  current: { id: string } | null;
  queue: Array<{
    id: string;
    redFighterName: string | null;
    blueFighterName: string | null;
    roundCode: string | null;
    matchNumberLabel: string | null;
    scoringConfig: LiceWaitingDisplayNextMatch['scoringConfig'];
    tournamentName: string | null;
  }>;
  hiddenFromPublic?: boolean;
}

/**
 * Read the piste's `/current` and project what the screen needs: the event
 * name and next bout for the waiting card, and the current bout's id for the
 * `DisplayView` hand-off. Null when the read is refused or never lands.
 */
export async function readLiceBoard(
  eventSlug: string,
  liceName: string,
): Promise<LiceBoard | null> {
  // A draft Event, or a bout of an unpublished Tournament, shows only to a club
  // member: a projector signed in as one sends its login (ruling 89), which
  // `apiRequest` does by default.
  const result = await apiRequest<CurrentBody>(
    // Client-side base URL (browser-reachable public host).
    getPublicApiUrl(),
    `/api/v1/events/${eventSlug}/lices/${encodeURIComponent(liceName)}/current`,
    { cache: 'no-store' },
  );
  if (!result.ok) return null;
  const body = result.data;
  const next = body.queue[0] ?? null;
  return {
    liceId: body.liceId,
    matchId: body.current?.id ?? null,
    eventName: body.event?.name ?? null,
    nextMatch: next
      ? {
          redFighterName: next.redFighterName,
          blueFighterName: next.blueFighterName,
          roundCode: next.roundCode,
          matchNumberLabel: next.matchNumberLabel,
          scoringConfig: next.scoringConfig,
          tournamentName: next.tournamentName,
        }
      : null,
    hiddenFromPublic: body.hiddenFromPublic === true,
  };
}

/** How long, and how many times, a completed bout's clock is waited for. */
export const CLOCK_END_WAIT_MS = 600;
export const CLOCK_END_RETRIES = 3;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Is the bout on screen over? Asked once when the piste stops naming it: a bout
 * that is over keeps the screen for its card's time, a bout that was moved or
 * reset does not. The bout's read and the rule are the scoreboard's own. A read
 * that fails says "not over": a failed read never holds a screen.
 *
 * A bout the closing hit ended is written `completed` FIRST, and its clock's
 * end row several writes later (`ScoringService.afterFightWrite`). A read
 * between the two sees a completed bout whose clock still runs. So a completed
 * bout whose clock has not ended is read again, a few times: its end row is on
 * its way. A bout completed with no clock at all (a forfeit) never gets one:
 * the scoreboard draws no card for it, and the screen does not hold it.
 */
export async function readBoutOver(
  matchId: string,
  pause: (ms: number) => Promise<void> = wait,
): Promise<boolean> {
  try {
    for (let reads = 1; ; reads += 1) {
      const read = await readLiveMatch(getPublicApiUrl(), matchId);
      if (!read.ok || !read.match) return false;
      if (boutIsOver(read.match.status, read.clock?.status)) return true;
      if (read.match.status !== 'completed' || reads > CLOCK_END_RETRIES) return false;
      await pause(CLOCK_END_WAIT_MS);
    }
  } catch {
    return false;
  }
}

/**
 * How often the screen re-reads its board while its channel is UP, or null for
 * not at all. A DOWN channel is `useRealtimeWithFallback`'s to poll, so no
 * channel status is passed. The rule is `livePollMs`, ruling 92's: a board
 * hidden from the public (its channel never announces a change), or a last
 * read that failed (a kiosk that started with an expired login, until its
 * keep-alive renewed it), is re-read every LIVE_POLL_MS.
 */
export function liceBoardPollMs(board: LiceBoard, lastReadFailed: boolean): number | null {
  return livePollMs({
    pollMs: LIVE_POLL_MS,
    channelStatus: null,
    connected: true,
    match: board,
    loadError: lastReadFailed ? 'failed' : null,
  });
}
