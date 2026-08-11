import { describe, expect, it } from 'vitest';
import {
  classifyQuarantineReason,
  summariseQuarantine,
  type QuarantinedForReport,
} from './quarantine-report';

function held(overrides: Partial<QuarantinedForReport> = {}): QuarantinedForReport {
  return { rejectedReason: 'HTTP 400', rejectedAt: 1_700_000_000_000, ...overrides };
}

describe('classifyQuarantineReason', () => {
  it.each([
    // The API's real wording, copied from scoring.service.ts rather than invented.
    ['Match is already completed', 'match_closed'],
    ['Round already closed', 'match_closed'],
    ['duplicate sequence for this match', 'sequence'],
    ['Validation failed', 'validation'],
    ['invalid exchange type', 'validation'],
  ] as const)('maps %j to %s', (reason, code) => {
    expect(classifyQuarantineReason(reason)).toBe(code);
  });

  it('buckets unrecognised text to other rather than guessing', () => {
    expect(classifyQuarantineReason('HTTP 400')).toBe('other');
    expect(classifyQuarantineReason('')).toBe('other');
  });
});

describe('summariseQuarantine', () => {
  it('summarises an empty store rather than returning nothing', () => {
    // The report doubles as a heartbeat: a device that only spoke up when
    // something was wrong would make silence and health indistinguishable.
    expect(summariseQuarantine([])).toEqual({
      quarantinedCount: 0,
      reasonCodes: [],
      oldestQuarantinedAt: null,
    });
  });

  it('counts held exchanges and dedupes their codes', () => {
    const summary = summariseQuarantine([
      held({ rejectedReason: 'Match is already completed' }),
      held({ rejectedReason: 'Round already closed' }),
      held({ rejectedReason: 'Validation failed' }),
    ]);
    expect(summary.quarantinedCount).toBe(3);
    expect(summary.reasonCodes).toEqual(['match_closed', 'validation']);
  });

  it('reports the OLDEST rejection, whatever order the entries arrive in', () => {
    const summary = summariseQuarantine([
      held({ rejectedAt: 1_700_000_500_000 }),
      held({ rejectedAt: 1_700_000_100_000 }),
      held({ rejectedAt: 1_700_000_900_000 }),
    ]);
    expect(summary.oldestQuarantinedAt).toBe(new Date(1_700_000_100_000).toISOString());
  });

  it('never carries the server message off the device', () => {
    // A 400 body can embed the offending value; the repo is public.
    const summary = summariseQuarantine([
      held({ rejectedReason: 'Key (email)=(someone@example.com) already exists' }),
    ]);
    expect(JSON.stringify(summary)).not.toContain('someone@example.com');
  });
});
