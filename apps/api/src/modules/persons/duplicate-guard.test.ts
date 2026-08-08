import { describe, expect, it } from 'vitest';
import { detectDuplicate, personNameKey } from './duplicate-guard';

describe('personNameKey', () => {
  it('is case- and edge-whitespace-insensitive', () => {
    expect(personNameKey('  Marie ', 'DUBOIS')).toBe(personNameKey('marie', 'dubois'));
  });

  it('keeps given and family name distinct', () => {
    // Without a separator, ('Ann', 'Marie') and ('Anna', 'Rie') would collide.
    expect(personNameKey('Ann', 'Marie')).not.toBe(personNameKey('Anna', 'rie'));
  });
});

describe('detectDuplicate', () => {
  it('reports an email match as a duplicate', () => {
    expect(detectDuplicate({ hasEmail: true, emailMatch: true, nameMatch: false })).toBe('email');
  });

  it('ignores the name entirely when an email is present', () => {
    // Two real fighters can share a name. The email is the identity, so a
    // name collision behind a fresh address must NOT block the second one.
    expect(detectDuplicate({ hasEmail: true, emailMatch: false, nameMatch: true })).toBeNull();
  });

  it('falls back to the name when there is no email', () => {
    expect(detectDuplicate({ hasEmail: false, emailMatch: false, nameMatch: true })).toBe('name');
  });

  it('passes a genuinely new person through', () => {
    expect(detectDuplicate({ hasEmail: false, emailMatch: false, nameMatch: false })).toBeNull();
    expect(detectDuplicate({ hasEmail: true, emailMatch: false, nameMatch: false })).toBeNull();
  });

  it('never consults a stale emailMatch once the email is gone', () => {
    // Guards against a caller that computes emailMatch from a previous row.
    expect(detectDuplicate({ hasEmail: false, emailMatch: true, nameMatch: false })).toBeNull();
  });
});
