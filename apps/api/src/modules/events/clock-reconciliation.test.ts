import { describe, expect, it } from 'vitest';
import {
  buildClockReconciliation,
  classifyClock,
  CLOCK_SKEW_REPORT_MS,
  type ExchangeClockRow,
  type MatchEnvelope,
  type StaffClockRow,
} from './clock-reconciliation';

const T0 = Date.parse('2026-08-08T09:00:00.000Z');
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

function staff(overrides: Partial<StaffClockRow> = {}): StaffClockRow {
  return {
    id: 'sa-1',
    username: 'piste1',
    clock_skew_ms: 0,
    last_seen_at: iso(0),
    ...overrides,
  };
}

function exchange(overrides: Partial<ExchangeClockRow> = {}): ExchangeClockRow {
  return {
    match_id: 'm1',
    staff_account_id: 'sa-1',
    occurred_at: iso(0),
    recorded_at: iso(0),
    ...overrides,
  };
}

const ENVELOPE: MatchEnvelope[] = [{ matchId: 'm1', startedAt: iso(0), endedAt: iso(180_000) }];

describe('classifyClock', () => {
  it('never reports an unmeasured clock as ok', () => {
    // A tablet that has not heartbeated since 0172 shipped has an UNKNOWN
    // clock. Averaging it in as zero would report a broken fleet as healthy —
    // the exact failure this feature exists to prevent.
    expect(classifyClock(null, null)).toBe('unmeasured');
  });

  it('prefers the heartbeat reading — it has no outbox in between', () => {
    expect(classifyClock(1_000, 999_999)).toBe('ok');
  });

  it('lets the exchange bound PROVE skew for a tablet that never heartbeated', () => {
    expect(classifyClock(null, CLOCK_SKEW_REPORT_MS + 1)).toBe('skewed');
  });

  it('never lets the exchange bound CLEAR a tablet', () => {
    // The asymmetry that matters: a delta of zero is produced by a perfect
    // tablet AND by one an hour ahead whose hits all waited an hour in the
    // outbox. Reading that as ok would be the report certifying what it cannot
    // see. Only the heartbeat, which measures directly, can return ok.
    expect(classifyClock(null, 0)).toBe('unmeasured');
    expect(classifyClock(null, CLOCK_SKEW_REPORT_MS - 1)).toBe('unmeasured');
  });

  it('flags skew in BOTH directions', () => {
    // Positive is a tablet ahead of the server, negative is behind. Getting the
    // sign wrong flips every "bout timed too long / too short" conclusion.
    expect(classifyClock(CLOCK_SKEW_REPORT_MS, null)).toBe('skewed');
    expect(classifyClock(-CLOCK_SKEW_REPORT_MS, null)).toBe('skewed');
  });

  it('treats anything under the threshold as noise', () => {
    // The heartbeat reading is one-way and carries network latency inside it.
    expect(classifyClock(CLOCK_SKEW_REPORT_MS - 1, null)).toBe('ok');
  });
});

describe('buildClockReconciliation', () => {
  it('includes a tablet that recorded nothing', () => {
    // "Configured and never used" is an answer an organiser wants; omitting it
    // would make the report silently about a subset.
    const report = buildClockReconciliation([staff()], [], ENVELOPE);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ exchangeCount: 0, estimatedSkewMs: null });
  });

  it('estimates skew from the LEAST DELAYED hit, not the average', () => {
    // delta = skew - latency, and latency is never negative, so the largest
    // delta is the closest approach to the truth. Here the tablet is 40s ahead
    // and one hit synced instantly while another waited five minutes.
    const report = buildClockReconciliation(
      [staff({ clock_skew_ms: null })],
      [
        exchange({ occurred_at: iso(40_000), recorded_at: iso(0) }),
        exchange({ occurred_at: iso(40_000), recorded_at: iso(300_000) }),
      ],
      ENVELOPE,
    );
    expect(report.rows[0]?.estimatedSkewMs).toBe(40_000);
    expect(report.rows[0]?.confidence).toBe('skewed');
  });

  it('reports a wifi drop as sync LAG, never as clock skew', () => {
    // A perfectly-set tablet whose referee scored through an outage. Calling
    // this skew would fire the report on every normal wifi drop, and a report
    // that cries wolf on the expected case is worse than no report.
    const report = buildClockReconciliation(
      [staff({ clock_skew_ms: null })],
      [exchange({ occurred_at: iso(0), recorded_at: iso(300_000) })],
      ENVELOPE,
    );
    expect(report.rows[0]?.worstSyncLagMs).toBe(300_000);
    // Inconclusive, NOT skewed: a negative bound is equally well explained by
    // the outbox draining late, and this tablet has never heartbeated.
    expect(report.rows[0]?.confidence).toBe('unmeasured');
  });

  it('refuses to call a negative bound skew even when it is enormous', () => {
    const report = buildClockReconciliation(
      [staff({ clock_skew_ms: null })],
      [exchange({ occurred_at: iso(0), recorded_at: iso(3_600_000) })],
      ENVELOPE,
    );
    expect(report.rows[0]?.estimatedSkewMs).toBe(-3_600_000);
    expect(report.rows[0]?.confidence).toBe('unmeasured');
  });

  it('trusts a heartbeat reading of zero over a wildly negative bound', () => {
    // The heartbeat is a direct measurement with no outbox in between.
    const report = buildClockReconciliation(
      [staff({ clock_skew_ms: 0 })],
      [exchange({ occurred_at: iso(0), recorded_at: iso(3_600_000) })],
      ENVELOPE,
    );
    expect(report.rows[0]?.confidence).toBe('ok');
  });

  it('reports no lag rather than negative lag for an instant sync', () => {
    const report = buildClockReconciliation(
      [staff()],
      [exchange({ occurred_at: iso(0), recorded_at: iso(0) })],
      ENVELOPE,
    );
    expect(report.rows[0]?.worstSyncLagMs).toBe(0);
  });

  it('flags a hit that claims to predate its own bout', () => {
    // Both envelope bounds are server-stamped, so this is the one comparison
    // with no queue latency mixed into it.
    const report = buildClockReconciliation(
      [staff()],
      [exchange({ occurred_at: iso(-5_000) })],
      ENVELOPE,
    );
    expect(report.rows[0]?.outOfEnvelopeCount).toBe(1);
  });

  it('flags a hit that claims to postdate its own bout', () => {
    const report = buildClockReconciliation(
      [staff()],
      [exchange({ occurred_at: iso(200_000) })],
      ENVELOPE,
    );
    expect(report.rows[0]?.outOfEnvelopeCount).toBe(1);
  });

  it('does NOT flag a bout with no recorded start', () => {
    // Clock actions are online-only, so an offline stretch leaves a hole in the
    // timeline rather than wrong data. Treating a gap as a fault would fire on
    // every wifi drop.
    const report = buildClockReconciliation(
      [staff()],
      [exchange({ occurred_at: iso(-5_000) })],
      [{ matchId: 'm1', startedAt: null, endedAt: null }],
    );
    expect(report.rows[0]?.outOfEnvelopeCount).toBe(0);
  });

  it('does not flag a still-running bout on its open end', () => {
    const report = buildClockReconciliation(
      [staff()],
      [exchange({ occurred_at: iso(999_000) })],
      [{ matchId: 'm1', startedAt: iso(0), endedAt: null }],
    );
    expect(report.rows[0]?.outOfEnvelopeCount).toBe(0);
  });

  it('ignores exchanges recorded by an organiser rather than a tablet', () => {
    // A hit entered through the admin app carries no staff account, and the
    // organiser's laptop clock is not the thing under review.
    const report = buildClockReconciliation(
      [staff()],
      [exchange({ staff_account_id: null, occurred_at: iso(600_000) })],
      ENVELOPE,
    );
    expect(report.rows[0]?.exchangeCount).toBe(0);
  });

  it('attributes each tablet only its own hits', () => {
    const report = buildClockReconciliation(
      [
        staff({ id: 'sa-1', username: 'piste1', clock_skew_ms: null }),
        staff({ id: 'sa-2', username: 'piste2', clock_skew_ms: null }),
      ],
      [
        exchange({ staff_account_id: 'sa-1', occurred_at: iso(40_000), recorded_at: iso(0) }),
        exchange({ staff_account_id: 'sa-2', occurred_at: iso(0), recorded_at: iso(0) }),
      ],
      ENVELOPE,
    );
    // sa-2 is 'unmeasured' rather than 'ok': it never heartbeated, and its
    // exchanges can only ever raise a hand, never clear one.
    expect(report.rows.map((r) => r.confidence)).toEqual(['skewed', 'unmeasured']);
    expect(report.rows.map((r) => r.exchangeCount)).toEqual([1, 1]);
  });

  it('counts what needs attention, and says when a clock was never measured', () => {
    const report = buildClockReconciliation(
      [
        staff({ id: 'sa-1', clock_skew_ms: 0 }),
        staff({ id: 'sa-2', clock_skew_ms: null }),
        staff({ id: 'sa-3', clock_skew_ms: 120_000 }),
      ],
      [],
      ENVELOPE,
    );
    expect(report.needsAttention).toBe(2);
    expect(report.hasUnmeasured).toBe(true);
  });

  it('survives an unparseable timestamp instead of reporting NaN', () => {
    const report = buildClockReconciliation(
      [staff()],
      [exchange({ occurred_at: 'not-a-date' })],
      ENVELOPE,
    );
    expect(report.rows[0]?.estimatedSkewMs).toBeNull();
    expect(report.rows[0]?.outOfEnvelopeCount).toBe(0);
  });
});
