import { describe, expect, it } from 'vitest';
import { STAFF_ROLES } from '@myclash/types';

import { resolveScreenAccess } from './screen-access';

describe('resolveScreenAccess', () => {
  it.each(STAFF_ROLES)('lets a %s account work its own screen', (role) => {
    expect(resolveScreenAccess(role, role)).toEqual({ kind: 'allow' });
  });

  // THE REGRESSION. A checkin account opened /gear by URL on 2026-08-21, got
  // the whole interface, and every call answered 403 — including the roster
  // read, so the screen showed an empty list and named no cause.
  it('sends a checkin account away from the gear screen, to its own', () => {
    expect(resolveScreenAccess('gear', 'checkin')).toEqual({
      kind: 'wrong_role',
      landingPath: '/desk',
    });
  });

  it('sends a gear account away from the desk, to its own', () => {
    expect(resolveScreenAccess('checkin', 'gear')).toEqual({
      kind: 'wrong_role',
      landingPath: '/gear',
    });
  });

  it.each(['checkin', 'gear'] as const)(
    'sends a %s account away from the piste screens',
    (role) => {
      expect(resolveScreenAccess('scoring', role).kind).toBe('wrong_role');
    },
  );

  // An organiser on the pad holds a claimed account session and NO staff role;
  // the API authorises them by org role. Refusing here would re-create the bug
  // that bounced every organiser without a PIN to /login.
  it.each(STAFF_ROLES)('lets a session with no staff role through to the %s screen', (screen) => {
    expect(resolveScreenAccess(screen, null)).toEqual({ kind: 'allow' });
    expect(resolveScreenAccess(screen, undefined)).toEqual({ kind: 'allow' });
  });

  // Offline scoring is hard rule 3. A pad that could not read its session must
  // render, not blank itself — the API still refuses anything it should.
  it('allows the screen when the session could not be read', () => {
    expect(resolveScreenAccess('scoring', null)).toEqual({ kind: 'allow' });
  });

  // parseStaffRole falls back to `scoring`, matching landingPathForRole: a row
  // written before 0173's CHECK is allowed on the piste and sent there from
  // elsewhere, rather than stranded on a screen it cannot leave.
  it('reads an unrecognised role as scoring, both ways', () => {
    expect(resolveScreenAccess('scoring', 'something-else')).toEqual({ kind: 'allow' });
    expect(resolveScreenAccess('gear', 'something-else')).toEqual({
      kind: 'wrong_role',
      landingPath: '/lices',
    });
  });
});
