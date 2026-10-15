import { describe, expect, it } from 'vitest';
import { createTranslator, getMessages } from '@myclash/i18n';
import { refereeRoleName, slotRoleName } from './referee-role-name';

const en = createTranslator(getMessages('en'));
const fr = createTranslator(getMessages('fr'));
const names = new Map([['custom-8f2a', 'Ring steward']]);

describe('refereeRoleName', () => {
  it("says the Event's own name of the role", () => {
    expect(refereeRoleName('custom-8f2a', en, names)).toBe('Ring steward');
  });

  it("says a built-in role in the reader's language when its row is not read", () => {
    expect(refereeRoleName('arbitre_declarant', en)).toBe('Lead referee');
  });

  it('says a role whose name is gone is removed, never its id (ruled 2026-10-15)', () => {
    expect(refereeRoleName('custom-0bad', en, names)).toBe('Role removed');
    expect(refereeRoleName('custom-0bad', fr)).toBe('Rôle supprimé');
  });
});

describe('slotRoleName', () => {
  it("says the slot's own name first, then its role's", () => {
    expect(slotRoleName({ displayName: 'Judge 2', role: 'custom-8f2a' }, en, names)).toBe(
      'Judge 2',
    );
    expect(slotRoleName({ displayName: null, role: 'custom-8f2a' }, en, names)).toBe(
      'Ring steward',
    );
  });
});
