import { describe, expect, it } from 'vitest';
import { MAX_LOGO_BYTES, validateLogoFile } from './validate-logo-file';

function makeFile(name: string, type: string, sizeBytes: number): File {
  // jsdom's File honours the provided byte length, but the actual content
  // doesn't matter for validation — we just need `.size` and `.type` to
  // reflect what the picker would yield.
  const blob = new Blob([new Uint8Array(sizeBytes)], { type });
  return new File([blob], name, { type });
}

describe('validateLogoFile', () => {
  it('accepts a PNG within the size cap', () => {
    expect(validateLogoFile(makeFile('logo.png', 'image/png', 200_000))).toEqual({ ok: true });
  });

  it('rejects a file over the 10 MB cap with the logoTooLarge key', () => {
    const tooBig = makeFile('huge.png', 'image/png', MAX_LOGO_BYTES + 1);
    expect(validateLogoFile(tooBig)).toEqual({
      ok: false,
      errorKey: 'organizer.events.logoTooLarge',
    });
  });

  it('rejects an unsupported mime with the logoWrongType key', () => {
    const svg = makeFile('logo.svg', 'image/svg+xml', 1_000);
    expect(validateLogoFile(svg)).toEqual({
      ok: false,
      errorKey: 'organizer.events.logoWrongType',
    });
  });
});
