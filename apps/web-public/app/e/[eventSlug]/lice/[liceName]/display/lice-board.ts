import { apiRequest } from '@myclash/api-client';
import { LIVE_POLL_MS, livePollMs, type LiceWaitingDisplayNextMatch } from '@myclash/ui';
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
