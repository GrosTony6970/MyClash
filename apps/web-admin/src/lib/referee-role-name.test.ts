import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  // The compensation pages keep their names in a plain object (review, 2026-10-16).
  it('reads the names from a plain object as from a Map', () => {
    expect(refereeRoleName('custom-8f2a', en, { 'custom-8f2a': 'Ring steward' })).toBe(
      'Ring steward',
    );
    expect(refereeRoleName('custom-0bad', en, { 'custom-8f2a': 'Ring steward' })).toBe(
      'Role removed',
    );
  });

  // A text pin: every page that names a role asks the one owner (src/lib/referee-role-name.ts).
  it('is what every organiser page asks, with no raw-id fallback left', () => {
    const root = join(__dirname, '..', '..', 'app');
    const hits = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .filter((file) =>
        /skillNameById(\.get\(\w+(\.role)?\)|\[\w+(\.role)?\]) \?\? \w+/.test(
          readFileSync(join(root, file), 'utf8'),
        ),
      );
    expect(hits).toEqual([]);
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
