import type { ClockSnapshot, DisplayMatch, ExchangeRow, Penalty } from '../types/match-events';

/**
 * The four reads behind a live scoreboard (`useLiveMatch`), run together.
 *
 * The bout decides: a refused bout is an error, reported in the API's own
 * words. A side read that fails is left out, so the scoreboard keeps what it
 * last had for it. Every read sends the login: a club member's screen shows the
 * bouts the public cannot see (rulings 81-83, 89).
 *
 * NOT `apiRequest` on purpose: this package ships CJS with no tree-shaking, so
 * a workspace dependency here is paid for by all three apps.
 */
export type LiveMatchRead =
  | {
      ok: true;
      match: DisplayMatch;
      penalties?: Penalty[];
      exchanges?: ExchangeRow[];
      clock?: ClockSnapshot;
    }
  | { ok: false; error: { status: number; message: string } };

const READ: RequestInit = { cache: 'no-store', credentials: 'include' };

export async function readLiveMatch(
  apiBaseUrl: string,
  matchId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LiveMatchRead> {
  const url = (path: string) => `${apiBaseUrl}/api/v1/matches/${matchId}/${path}`;
  try {
    const [matchRes, penaltyRes, exchangeRes, clockRes] = await Promise.all([
      fetchImpl(url('display'), READ),
      fetchImpl(url('penalties'), READ),
      fetchImpl(url('exchanges'), READ),
      fetchImpl(url('clock'), READ),
    ]);
    if (!matchRes.ok) {
      // `detail` first: it is the member RFC 9457 specifies, and `message` is
      // the compatibility extension the API fills with the same string today.
      const body = (await matchRes.json().catch(() => null)) as {
        detail?: string;
        message?: string;
      } | null;
      return {
        ok: false,
        error: {
          status: matchRes.status,
          message: body?.detail ?? body?.message ?? matchRes.statusText,
        },
      };
    }
    const read: LiveMatchRead = { ok: true, match: (await matchRes.json()) as DisplayMatch };
    if (penaltyRes.ok) read.penalties = (await penaltyRes.json()) as Penalty[];
    if (exchangeRes.ok) read.exchanges = (await exchangeRes.json()) as ExchangeRow[];
    if (clockRes.ok) read.clock = (await clockRes.json()) as ClockSnapshot;
    return read;
  } catch (err) {
    return {
      ok: false,
      error: { status: 0, message: err instanceof Error ? err.message : 'Network error' },
    };
  }
}
