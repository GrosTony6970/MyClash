import { describe, expect, it } from 'vitest';
import type { ExistingPenaltyForSanction } from '@myclash/types';
import { resolveEntryCard, type WireEntry } from './resolve-entry-card';

/** Group 3, escalating yellow → red → red → black. */
const ENTRY: WireEntry = {
  group_number: 3,
  ref_number: 6,
  short_name: 'Non-combativité',
  description: 'Absence d’action offensive',
  sanctions: ['yellow', 'red', 'red', 'black'],
};

const prior = (over: Partial<ExistingPenaltyForSanction>): ExistingPenaltyForSanction => ({
  registrationId: 'reg-red',
  groupNumber: 3,
  card: 'yellow',
  source: 'ruleset',
  ...over,
});

describe('resolveEntryCard', () => {
  it('shows the first-occurrence card for a fighter with a clean sheet', () => {
    expect(resolveEntryCard(ENTRY, 'reg-red', [])).toBe('yellow');
  });

  /**
   * THE BUG. The picker showed `sanctions[0]` unconditionally, so a fighter on
   * their second offence in this group saw yellow on the button while the
   * server issued red. Nothing on screen suggested a disagreement.
   */
  it('escalates on a second offence in the same group', () => {
    expect(resolveEntryCard(ENTRY, 'reg-red', [prior({})])).toBe('red');
  });

  it('repeats the last sanction once the ladder runs out', () => {
    const four = [prior({}), prior({}), prior({}), prior({})];
    expect(resolveEntryCard(ENTRY, 'reg-red', four)).toBe('black');
  });

  it('does not escalate on an offence in a different group', () => {
    expect(resolveEntryCard(ENTRY, 'reg-red', [prior({ groupNumber: 2 })])).toBe('yellow');
  });

  it('does not escalate on the other fighter’s offences', () => {
    expect(resolveEntryCard(ENTRY, 'reg-red', [prior({ registrationId: 'reg-blue' })])).toBe(
      'yellow',
    );
  });

  it('does not escalate on a voided card, which did not happen', () => {
    expect(resolveEntryCard(ENTRY, 'reg-red', [prior({ voided: true })])).toBe('yellow');
  });

  it('does not escalate on a direct card, which is outside the catalogue', () => {
    // A direct card is the referee overriding the ruleset; it is not a rung on
    // this group's ladder.
    expect(resolveEntryCard(ENTRY, 'reg-red', [prior({ source: 'direct' })])).toBe('yellow');
  });

  /**
   * TOURNAMENT SCOPE is the reason the priors come from the API rather than
   * from the match's own penalty list: at that scope the offences sit in OTHER
   * matches the pad has never loaded. This is the same call with the wider
   * array — the pad does not decide the scope, it is told.
   */
  it('escalates on a prior from another match when the scope is the tournament', () => {
    expect(resolveEntryCard(ENTRY, 'reg-red', [prior({}), prior({})])).toBe('red');
  });

  it('falls back to the first-occurrence card when the priors have not loaded', () => {
    // Undefined is "not read yet", which is different from "read, and empty".
    // Degrading to the old behaviour beats showing a blank or a wrong claim.
    expect(resolveEntryCard(ENTRY, 'reg-red', undefined)).toBe('yellow');
  });
});
