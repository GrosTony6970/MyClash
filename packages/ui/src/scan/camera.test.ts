import { describe, expect, it } from 'vitest';
import { classifyCameraError, isNewScan, REPEAT_SUPPRESSION_MS, type ScanMemory } from './camera';

describe('classifyCameraError', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'no_camera'],
    ['OverconstrainedError', 'no_camera'],
    ['NotReadableError', 'busy'],
    ['AbortError', 'busy'],
  ])('maps %s to %s', (name, expected) => {
    expect(classifyCameraError({ name })).toBe(expected);
  });

  it('falls back to a generic failure for anything unrecognised', () => {
    expect(classifyCameraError({ name: 'SomethingNew' })).toBe('failed');
    expect(classifyCameraError(new Error('boom'))).toBe('failed');
    expect(classifyCameraError(null)).toBe('failed');
  });

  it('keys on the DOMException NAME, never the message', () => {
    // Messages are localised by the browser and differ per engine; a volunteer
    // on a French tablet must land on the same state as one on an English one.
    expect(classifyCameraError({ name: 'NotAllowedError', message: 'Permission refusée' })).toBe(
      'denied',
    );
  });
});

describe('isNewScan', () => {
  const fresh: ScanMemory = { token: null, at: 0 };

  it('accepts the first read', () => {
    expect(isNewScan('tok-a', fresh, 1000)).toBe(true);
  });

  it('accepts a different token immediately', () => {
    // The queue moves: the next fighter steps up while the last pass is still
    // within the suppression window.
    expect(isNewScan('tok-b', { token: 'tok-a', at: 1000 }, 1050)).toBe(true);
  });

  it('suppresses the SAME token on the very next frame', () => {
    // A QR held in front of a camera decodes every frame. Without this, one
    // fighter standing still fires a dozen requests a second.
    expect(isNewScan('tok-a', { token: 'tok-a', at: 1000 }, 1120)).toBe(false);
  });

  it('lets the same token through again after the window', () => {
    // A fighter sent away for gear and coming back, or a mis-scan the volunteer
    // undid, must be re-scannable. A permanent dedupe would refuse them with no
    // way to explain why.
    expect(isNewScan('tok-a', { token: 'tok-a', at: 1000 }, 1000 + REPEAT_SUPPRESSION_MS)).toBe(
      true,
    );
  });

  it('holds the token out for the whole window, not part of it', () => {
    expect(isNewScan('tok-a', { token: 'tok-a', at: 1000 }, 1000 + REPEAT_SUPPRESSION_MS - 1)).toBe(
      false,
    );
  });
});
