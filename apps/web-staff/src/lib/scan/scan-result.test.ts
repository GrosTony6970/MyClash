import { describe, expect, it } from 'vitest';
import { classifyScanFailure, scanFailureKey, type ScanFailure } from './scan-result';

const FAILURES: ScanFailure[] = ['unknown', 'expired', 'forbidden', 'offline', 'failed'];

describe('classifyScanFailure', () => {
  it('separates an expired pass from an unrecognised one, though both are 404', () => {
    // The difference is the whole content of what the volunteer is told: one
    // means "type their name instead", the other "that is last month's pass".
    expect(classifyScanFailure({ status: 404, body: { message: 'pass_expired' } })).toBe('expired');
    expect(classifyScanFailure({ status: 404, body: { message: 'pass_not_recognized' } })).toBe(
      'unknown',
    );
  });

  it('reads the detail field too — problem+json uses either', () => {
    expect(classifyScanFailure({ status: 404, body: { detail: 'pass_expired' } })).toBe('expired');
  });

  it('prefers detail over message, the way the rest of the repo now reads a body', () => {
    // They carry the same string today, so this only bites the day they stop.
    // `detail` is the member RFC 9457 specifies and `message` the compatibility
    // extension, and `readDetail` in @myclash/api-client reads them in that
    // order — this file read them the other way round until 2026-08-20.
    expect(
      classifyScanFailure({
        status: 404,
        body: { detail: 'pass_expired', message: 'pass_not_recognized' },
      }),
    ).toBe('expired');
  });

  it('treats the service worker offline 503 as offline, not as a server fault', () => {
    // apps/web-staff/public/sw.js turns a dead network into a synthetic 503.
    expect(classifyScanFailure({ status: 503 })).toBe('offline');
  });

  it('treats a thrown network error with no status as offline', () => {
    expect(classifyScanFailure(new Error('Failed to fetch'))).toBe('offline');
    expect(classifyScanFailure(null)).toBe('offline');
  });

  it('never trusts a 5xx message — the filter scrubs every one of them', () => {
    // The exception filter flattens every >=500 body to "Internal server
    // error", so a message found there would be a lie.
    expect(classifyScanFailure({ status: 500, body: { message: 'pass_expired' } })).toBe('failed');
  });

  it('maps a rejected staff session to forbidden, not to a broken pass', () => {
    expect(classifyScanFailure({ status: 403 })).toBe('forbidden');
    expect(classifyScanFailure({ status: 401 })).toBe('forbidden');
  });

  it('falls back to a generic failure for a 400 it does not recognise', () => {
    expect(classifyScanFailure({ status: 400, body: { message: 'something else' } })).toBe(
      'failed',
    );
  });
});

describe('scanFailureKey', () => {
  it('returns a distinct key per failure, so no two states share a message', () => {
    const keys = FAILURES.map(scanFailureKey);
    expect(new Set(keys).size).toBe(FAILURES.length);
  });

  it('returns literal keys under scoring.scan — the i18n sweep reads these statically', () => {
    for (const failure of FAILURES) {
      expect(scanFailureKey(failure)).toMatch(/^scoring\.scan\.error[A-Z]/);
    }
  });
});
