import { describe, expect, it } from 'vitest';
import {
  isValidPinShape,
  isWeakPin,
  STAFF_PIN_MAX_LENGTH,
  STAFF_PIN_MIN_LENGTH,
} from './pin-strength';

describe('isWeakPin', () => {
  describe('every digit the same', () => {
    it.each(['000000', '111111', '999999', '99999999', '4444444444'])('rejects %s', (pin) => {
      expect(isWeakPin(pin)).toBe('repeated_digit');
    });
  });

  describe('a run of ±1', () => {
    it.each(['123456', '654321', '0123456789', '345678', '876543'])('rejects %s', (pin) => {
      expect(isWeakPin(pin)).toBe('sequence');
    });

    it('rejects a run that wraps past 9', () => {
      expect(isWeakPin('789012')).toBe('sequence');
    });

    it('rejects a descending run that wraps past 0', () => {
      expect(isWeakPin('210987')).toBe('sequence');
    });
  });

  describe('a repeated 2- or 3-digit block', () => {
    it.each(['121212', '123123', '696969', '454545', '987987'])('rejects %s', (pin) => {
      expect(isWeakPin(pin)).toBe('repeated_block');
    });
  });

  describe('the explicit denylist', () => {
    it.each(['112233', '123321', '147258', '159753', '100200'])('rejects %s', (pin) => {
      expect(isWeakPin(pin)).toBe('common');
    });
  });

  describe('near-misses that must be allowed', () => {
    // Each of these is one digit away from a rule above. If a rule ever gets
    // greedy, this is where it shows up — a policy that rejects what people
    // actually choose sends them back to 123456 via the reset button.
    it.each([
      '123457', // a run that breaks on the last digit
      '102030', // looks patterned, is not a run and not a repeated block
      '481902',
      '112234', // one digit off 112233
      '121213', // one digit off 121212
      '123124', // one digit off 123123
      '135791', // a constant +2 step, deliberately not a rule
      '9999998', // one digit short of every-digit-the-same
    ])('accepts %s', (pin) => {
      expect(isWeakPin(pin)).toBeNull();
    });
  });

  it('accepts a long non-patterned PIN at the 16-digit ceiling', () => {
    expect(isWeakPin('4819025736410827')).toBeNull();
  });

  it('does not treat an odd-length PIN as a repeated block', () => {
    // 7 digits cannot be a whole number of 2- or 3-digit units, so the block
    // rule must not partial-match its way into a rejection.
    expect(isWeakPin('1212124')).toBeNull();
  });
});

describe('isValidPinShape', () => {
  it('pins the range the DTO and the organiser form both read', () => {
    expect(STAFF_PIN_MIN_LENGTH).toBe(6);
    expect(STAFF_PIN_MAX_LENGTH).toBe(16);
  });

  it.each(['481902', '4819025736410827'])('accepts %s', (pin) => {
    expect(isValidPinShape(pin)).toBe(true);
  });

  it.each([
    '48190', // one short of the floor
    '48190257364108270', // one past the ceiling
    '48190a', // not digits
    '48 902', // whitespace is not a digit
    '',
  ])('rejects %s', (pin) => {
    expect(isValidPinShape(pin)).toBe(false);
  });
});
