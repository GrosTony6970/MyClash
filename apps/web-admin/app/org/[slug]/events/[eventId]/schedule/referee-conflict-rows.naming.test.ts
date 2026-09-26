/**
 * The live half's words and ids: a row never shows a person id, and two people are never
 * paired through an id from the wrong space. Rules are in referee-conflict-rows.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type {
  RefereeConflictAssignment,
  RefereeConflictRegistration,
} from './referee-conflict-rows';
import {
  PERSON_UUID,
  UNKNOWN,
  build,
  denisIs,
  match,
  onBout,
} from './referee-conflict-rows.fixtures';

describe('buildRefereeConflictRows — naming', () => {
  const clash = (
    assignment: RefereeConflictAssignment,
    registrations: RefereeConflictRegistration[],
  ) =>
    build({
      matches: [match({ id: 'A' }), match({ id: 'B', scheduledAt: '2026-06-13T13:02:00Z' })],
      assignments: [assignment],
      registrations,
    });

  it('never renders a person id — falls back to the caller label', () => {
    const rows = clash(onBout('B', { personId: PERSON_UUID, personName: '' }), [
      { registrationId: 'reg-red-A', personId: PERSON_UUID, personName: '' },
    ]);
    expect(rows[0]!.personName).toBe(UNKNOWN);
    expect(JSON.stringify(rows.map((r) => r.personName))).not.toContain(PERSON_UUID);
  });

  it('treats a whitespace-only name as no name, and borrows the registration name', () => {
    const rows = clash(onBout('B', { personName: '   ' }), [denisIs('reg-red-A')]);
    expect(rows[0]!.personName).toBe('Denis');
  });

  it('falls back to the bout number when a bout has no canonical code', () => {
    const rows = clash(onBout('B'), [denisIs('reg-red-A')]);
    expect(rows[0]!.refereeingLabel).toBe('Longsword · B');
  });
});

describe('buildRefereeConflictRows — id spaces', () => {
  it('joins on the person id, not the registration id', () => {
    const rows = build({
      matches: [match({ id: 'A' }), match({ id: 'B', scheduledAt: '2026-06-13T13:02:00Z' })],
      assignments: [onBout('B', { personId: 'reg-red-A' })],
      registrations: [denisIs('reg-red-A')],
    });
    expect(rows).toEqual([]);
  });

  it('does not pair two unresolved people through an empty id', () => {
    const rows = build({
      matches: [match({ id: 'A' }), match({ id: 'B', scheduledAt: '2026-06-13T13:02:00Z' })],
      assignments: [onBout('B', { personId: '' })],
      registrations: [{ registrationId: 'reg-red-A', personId: '', personName: '' }],
    });
    expect(rows).toEqual([]);
  });
});
