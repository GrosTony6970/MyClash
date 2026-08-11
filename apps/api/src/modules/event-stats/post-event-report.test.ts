import { describe, expect, it } from 'vitest';
import { buildPostEventReport, type DeviceSyncRow, type PostEventInput } from './post-event-report';

const CUTOFF = '2026-08-01T17:00:00.000Z';

function device(overrides: Partial<DeviceSyncRow> = {}): DeviceSyncRow {
  return {
    deviceId: 'dev-a',
    deviceLabel: 'Tablet A',
    peakQuarantinedCount: 0,
    quarantinedCount: 0,
    reasonCodes: [],
    lastReportedAt: '2026-08-01T18:00:00.000Z',
    ...overrides,
  };
}

function input(overrides: Partial<PostEventInput> = {}): PostEventInput {
  return { devices: [], overrides: [], arrivals: [], clockFlaggedCount: 0, ...overrides };
}

function section(report: ReturnType<typeof buildPostEventReport>, key: string) {
  return report.sections.find((s) => s.key === key)!;
}

describe('buildPostEventReport', () => {
  it('reports a clean event with every section present and none needing attention', () => {
    // Empty sections must still render: a missing section reads as "not
    // checked", which is the opposite of the reassurance a clean report gives.
    const report = buildPostEventReport(input(), CUTOFF);
    expect(report.needsAttention).toBe(false);
    expect(report.sections.map((s) => s.key)).toEqual([
      'refusedExchanges',
      'silentDevices',
      'overrides',
      'voidedOverrides',
      'arrivals',
      'clockDrift',
    ]);
  });

  it('surfaces a device that recovered, because the hits were still refused', () => {
    // The whole reason the table keeps a high-water mark.
    const report = buildPostEventReport(
      input({
        devices: [
          device({ peakQuarantinedCount: 3, quarantinedCount: 0, reasonCodes: ['sequence'] }),
        ],
      }),
      CUTOFF,
    );
    const refused = section(report, 'refusedExchanges');
    expect(refused.severity).toBe('attention');
    expect(refused.count).toBe(3);
    expect(refused.details[0]).toContain('Tablet A: 3 refused');
    expect(refused.details[0]).not.toContain('still held');
    expect(report.needsAttention).toBe(true);
  });

  it('says how many are STILL held when a device never drained', () => {
    const report = buildPostEventReport(
      input({ devices: [device({ peakQuarantinedCount: 4, quarantinedCount: 2 })] }),
      CUTOFF,
    );
    expect(section(report, 'refusedExchanges').details[0]).toContain('2 still held');
  });

  it('counts a silent device separately from one holding refusals', () => {
    // A device that stopped talking may have been holding anything; folding it
    // into the known-problem count would hide the worse case in the better one.
    const report = buildPostEventReport(
      input({
        devices: [
          device({
            deviceId: 'quiet',
            deviceLabel: 'Tablet B',
            lastReportedAt: '2026-08-01T09:00:00.000Z',
          }),
        ],
      }),
      CUTOFF,
    );
    expect(section(report, 'refusedExchanges').count).toBe(0);
    expect(section(report, 'silentDevices').count).toBe(1);
    expect(section(report, 'silentDevices').details).toEqual(['Tablet B']);
  });

  it('names an unlabelled device without leaking its id', () => {
    const report = buildPostEventReport(
      input({ devices: [device({ deviceLabel: null, peakQuarantinedCount: 1 })] }),
      CUTOFF,
    );
    const line = section(report, 'refusedExchanges').details[0]!;
    expect(line).toContain('unlabelled device');
    expect(line).not.toContain('dev-a');
  });

  it('separates live overrides from voided ones and never flags either', () => {
    // An override is a legitimate tool. Recording it is the point; calling it a
    // fault would teach organisers to avoid the honest path.
    const report = buildPostEventReport(
      input({
        overrides: [
          { reason: 'injury', voided: false },
          { reason: 'injury', voided: false },
          { reason: 'no_show', voided: false },
          { reason: 'injury', voided: true },
        ],
      }),
      CUTOFF,
    );
    expect(section(report, 'overrides').count).toBe(3);
    expect(section(report, 'overrides').details).toEqual(['injury: 2', 'no_show: 1']);
    expect(section(report, 'voidedOverrides').count).toBe(1);
    expect(report.needsAttention).toBe(false);
  });

  it('excludes reversed arrivals from the desk count', () => {
    const report = buildPostEventReport(
      input({
        arrivals: [
          { via: 'search', reversed: false },
          { via: 'qr', reversed: false },
          { via: 'qr', reversed: true },
        ],
      }),
      CUTOFF,
    );
    expect(section(report, 'arrivals').count).toBe(2);
    expect(section(report, 'arrivals').details).toEqual(['qr: 1', 'search: 1']);
  });

  it('flags clock drift from the count the reconciliation report produced', () => {
    const report = buildPostEventReport(input({ clockFlaggedCount: 2 }), CUTOFF);
    expect(section(report, 'clockDrift').severity).toBe('attention');
    expect(report.needsAttention).toBe(true);
  });
});
