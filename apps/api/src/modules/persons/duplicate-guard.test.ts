import { describe, expect, it } from 'vitest';
import { detectDuplicate, importDuplicateReason, personNameKey } from './duplicate-guard';

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

describe('importDuplicateReason', () => {
  const people = (emails: string[], names: string[]) => ({
    emails: new Set(emails),
    names: new Set(names),
  });

  // An earlier row, Léa with her own address, took her name; a later row with no
  // address holds the same name, which the roster holds too. The roster is asked first.
  it('says on the roster when the roster and an earlier row both hold the person', () => {
    const roster = people([], ['léa martin']);
    const earlier = people(['lea@b.fr'], ['léa martin']);
    expect(importDuplicateReason(undefined, 'léa martin', roster, earlier)).toBe(
      'already_on_roster',
    );
  });

  it('says earlier in the file, or nothing, by the same email-first rule', () => {
    const earlier = people(['paul@b.fr'], ['paul petit']);
    const none = people([], []);
    expect(importDuplicateReason('paul@b.fr', 'x y', none, earlier)).toBe('repeated_in_file');
    expect(importDuplicateReason('new@b.fr', 'paul petit', none, earlier)).toBeNull();
  });
});
