/**
 * Can the timestamps on this event's results be trusted?
 *
 * ── What 0172 promised, and what is actually true ───────────────────────────
 *
 * Migration 0172's header states that "the start/halt/resume transitions in
 * `match_events` are all stamped with the tablet's own Date.now()". That is
 * FALSE. Every writer of `match_events` uses the server's clock —
 * `clock.service.ts` (start/halt/resume), `matches.service.ts` and
 * `scoring.service.ts` (round events) all insert `new Date().toISOString()`.
 * A report built on "compare the tablet's match_events stamps to the server's"
 * would be identically zero for every row in the database, forever, and would
 * look like a clean bill of health.
 *
 * The one place a tablet's own clock reaches the database is
 * `exchanges.occurred_at`, which comes straight off the DTO
 * (`matches.service.ts`, `occurred_at: dto.occurredAt`), beside a `recorded_at`
 * that defaults to the server's NOW(). That pair is the signal.
 *
 * ── Why the naive delta is not skew ─────────────────────────────────────────
 *
 * Writing T for the real instant of the hit:
 *
 *     occurred_at = T + skew          (the tablet's clock at tap time)
 *     recorded_at = T + latency       (the server's clock at insert time)
 *     delta       = skew - latency
 *
 * `latency` is the time between the tap and the row landing — never negative,
 * and unbounded upward: an offline referee's hit sits in the outbox until the
 * wifi returns, so a perfectly-set tablet can produce a delta of minus five
 * minutes. Reporting that as clock skew would fire on every normal wifi drop,
 * and a report that cries wolf on the expected case is worse than no report.
 *
 * Because latency >= 0, `delta <= skew` always. So the MAXIMUM delta across a
 * tablet's exchanges — the least-delayed hit — is a lower bound on its skew,
 * and every other reading is queue lag, reported separately and by its own name.
 *
 * A lower bound is ASYMMETRIC, and this is the part worth reading twice:
 * exchanges can PROVE skew but can never DISPROVE it.
 *
 *   delta >= +30s  →  skew >= 30s whatever the latency was. Proven.
 *   delta <  +30s  →  skew is somewhere in [delta, +inf). A tablet an hour
 *                     ahead whose hits all waited an hour in the outbox
 *                     produces delta = 0, and so does a perfect one.
 *
 * So the exchange path may only ever conclude `skewed` or `unmeasured` — never
 * `ok`. Only the heartbeat, which measures directly with no outbox in between,
 * can clear a tablet. Letting a small delta read as `ok` would be the report
 * quietly certifying the thing it cannot see.
 *
 * Pure and dependency-free: every rule here is a judgement about when a clock
 * is worth mentioning, so it needs to be testable without a Supabase mock.
 */

/**
 * Anything under this is noise and is not reported.
 *
 * Mirrors `CLOCK_SKEW_REPORT_MS` on the Live board rather than introducing a
 * second number: two thresholds for the same fact drift, and the first person
 * to notice is an organiser being told two different things about one tablet.
 * The heartbeat reading is one-way and carries network latency inside it, so
 * anything tighter than this measures the venue's wifi, not the clock.
 */
export const CLOCK_SKEW_REPORT_MS = 30_000;

export type ClockConfidence =
  /** Measured, and within tolerance. */
  | 'ok'
  /** Measured, and out. Timings recorded by this tablet are suspect. */
  | 'skewed'
  /**
   * Never measured. NOT the same as ok — a tablet that has not heartbeated
   * since 0172 shipped, or one that never came online, has an unknown clock,
   * and averaging it in as zero would report a broken fleet as healthy.
   */
  | 'unmeasured';

/** One scoring tablet's row in the report. */
export interface ClockReconciliationRow {
  staffAccountId: string;
  username: string;
  /** Latest heartbeat reading. Positive = tablet AHEAD of the server. Null = never measured. */
  heartbeatSkewMs: number | null;
  lastSeenAt: string | null;
  /** Exchanges this account recorded, over which the estimate below is taken. */
  exchangeCount: number;
  /**
   * Skew as the exchanges see it: the maximum of (occurred_at - recorded_at),
   * which is a LOWER BOUND. Null when the account has recorded nothing.
   * Negative values are inconclusive — see the module header — and are shown
   * for context but never used to classify.
   */
  estimatedSkewMs: number | null;
  /**
   * The worst queue lag observed — how long the slowest hit waited before it
   * landed. Reported by its own name because it is NOT a clock problem: it is
   * the outbox doing exactly its job through a wifi drop.
   */
  worstSyncLagMs: number | null;
  /**
   * Exchanges whose tablet timestamp falls outside their own bout's
   * server-stamped start..end window. Unambiguous: a hit cannot have happened
   * before the clock started or after it ended.
   */
  outOfEnvelopeCount: number;
  confidence: ClockConfidence;
}

export interface ClockReconciliationReport {
  rows: ClockReconciliationRow[];
  /** Accounts whose confidence is anything but `ok`. Drives the headline. */
  needsAttention: number;
  /** True when at least one tablet has never reported a clock at all. */
  hasUnmeasured: boolean;
}

/** A `event_staff_accounts` row, as the report reads it. */
export interface StaffClockRow {
  id: string;
  username: string;
  clock_skew_ms: number | null;
  last_seen_at: string | null;
}

/** An `exchanges` row joined to the staff account that recorded it. */
export interface ExchangeClockRow {
  match_id: string;
  staff_account_id: string | null;
  occurred_at: string;
  recorded_at: string;
}

/** A bout's server-stamped envelope, from `match_events`. */
export interface MatchEnvelope {
  matchId: string;
  startedAt: string | null;
  endedAt: string | null;
}

/**
 * Classify one tablet.
 *
 * The heartbeat reading wins when it exists, and is the ONLY thing that can
 * return `ok`: it measures directly, with no outbox in between. The exchange
 * bound is the fallback for a tablet that scored before the heartbeat carried a
 * clock, or that has since gone away — and it can only ever raise a hand, never
 * clear one. See the module header for why that asymmetry is real rather than
 * conservative.
 */
export function classifyClock(
  heartbeatSkewMs: number | null,
  estimatedSkewMs: number | null,
): ClockConfidence {
  if (heartbeatSkewMs !== null) {
    return Math.abs(heartbeatSkewMs) >= CLOCK_SKEW_REPORT_MS ? 'skewed' : 'ok';
  }

  // A bound at or over the threshold proves skew. Anything below it proves
  // NOTHING — the same delta is produced by a perfect tablet and by one an hour
  // ahead whose hits all waited an hour in the outbox.
  if (estimatedSkewMs !== null && estimatedSkewMs >= CLOCK_SKEW_REPORT_MS) return 'skewed';

  return 'unmeasured';
}

/**
 * Build the report.
 *
 * Every staff account appears, including ones that recorded nothing — "this
 * tablet was configured and never used" is an answer an organiser wants, and
 * omitting it would make the report silently about a subset.
 */
export function buildClockReconciliation(
  staff: StaffClockRow[],
  exchanges: ExchangeClockRow[],
  envelopes: MatchEnvelope[],
): ClockReconciliationReport {
  const envelopeByMatch = new Map(envelopes.map((envelope) => [envelope.matchId, envelope]));
  const byAccount = groupExchangesByAccount(exchanges);

  const rows = staff.map((account): ClockReconciliationRow => {
    const own = byAccount.get(account.id) ?? [];
    const stats = summariseExchanges(own, envelopeByMatch);
    return {
      staffAccountId: account.id,
      username: account.username,
      heartbeatSkewMs: account.clock_skew_ms,
      lastSeenAt: account.last_seen_at,
      exchangeCount: own.length,
      ...stats,
      confidence: classifyClock(account.clock_skew_ms, stats.estimatedSkewMs),
    };
  });

  return {
    rows,
    needsAttention: rows.filter((row) => row.confidence !== 'ok').length,
    hasUnmeasured: rows.some((row) => row.confidence === 'unmeasured'),
  };
}

function groupExchangesByAccount(exchanges: ExchangeClockRow[]): Map<string, ExchangeClockRow[]> {
  const byAccount = new Map<string, ExchangeClockRow[]>();
  for (const exchange of exchanges) {
    // A hit with no staff account was recorded by an organiser through the
    // admin app, whose clock is not the thing under review.
    if (!exchange.staff_account_id) continue;
    const list = byAccount.get(exchange.staff_account_id) ?? [];
    list.push(exchange);
    byAccount.set(exchange.staff_account_id, list);
  }
  return byAccount;
}

/**
 * Fold one account's exchanges.
 *
 * `estimatedSkewMs` is the MAX delta and `worstSyncLagMs` the most negative
 * one, for the reason spelled out in the module header: delta = skew - latency
 * with latency never negative, so the largest delta is the least-delayed hit
 * and the smallest is the most-delayed.
 */
function summariseExchanges(
  exchanges: ExchangeClockRow[],
  envelopeByMatch: Map<string, MatchEnvelope>,
): Pick<ClockReconciliationRow, 'estimatedSkewMs' | 'worstSyncLagMs' | 'outOfEnvelopeCount'> {
  if (exchanges.length === 0) {
    return { estimatedSkewMs: null, worstSyncLagMs: null, outOfEnvelopeCount: 0 };
  }

  let maxDelta = Number.NEGATIVE_INFINITY;
  let minDelta = Number.POSITIVE_INFINITY;
  let outOfEnvelope = 0;

  for (const exchange of exchanges) {
    const delta = Date.parse(exchange.occurred_at) - Date.parse(exchange.recorded_at);
    if (!Number.isFinite(delta)) continue;
    maxDelta = Math.max(maxDelta, delta);
    minDelta = Math.min(minDelta, delta);
    if (isOutsideEnvelope(exchange, envelopeByMatch.get(exchange.match_id))) outOfEnvelope += 1;
  }

  if (!Number.isFinite(maxDelta)) {
    return { estimatedSkewMs: null, worstSyncLagMs: null, outOfEnvelopeCount: outOfEnvelope };
  }

  return {
    estimatedSkewMs: maxDelta,
    // Lag is the delay, so it is reported as a positive duration. A tablet
    // whose every hit synced instantly has no lag rather than negative lag.
    worstSyncLagMs: Math.max(0, -minDelta),
    outOfEnvelopeCount: outOfEnvelope,
  };
}

/**
 * Did this hit claim to happen outside its own bout?
 *
 * Both bounds come from `match_events`, which is SERVER-stamped, so this
 * compares a tablet's clock against a trustworthy one — the only comparison in
 * the report that does not have queue latency mixed into it.
 *
 * A bout with no recorded start is not an anomaly: clock actions are online
 * only, so an offline stretch leaves a HOLE in the timeline rather than wrong
 * data, and treating a gap as a fault would fire on every wifi drop.
 */
function isOutsideEnvelope(
  exchange: ExchangeClockRow,
  envelope: MatchEnvelope | undefined,
): boolean {
  if (!envelope?.startedAt) return false;
  const at = Date.parse(exchange.occurred_at);
  if (!Number.isFinite(at)) return false;
  if (at < Date.parse(envelope.startedAt)) return true;
  return envelope.endedAt ? at > Date.parse(envelope.endedAt) : false;
}
