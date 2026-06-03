import { describe, expect, it } from 'vitest';
import {
  computePenaltySanction,
  normalizePenaltyCard,
  parsePenaltyRulesetCsv,
  penaltyScoreDelta,
} from './index';

describe('penalty rulesets', () => {
  it('accepts alphanumeric REF identifiers (e.g. R7a, B-12)', () => {
    // Real rulebooks use codes like "R7a" or "B-12" for sub-rules. The
    // engine treats refNumber as an opaque identifier, not a counter,
    // so we keep it as a string and only enforce non-empty + safe-char
    // length bounds at the validator boundary.
    const csv = [
      'Group;Ref;short name;description;sanction 1;sanction 2;sanction 3;sanction 4',
      '1;R7a;Test;Description text;Jaune;;;',
    ].join('\n');

    const parsed = parsePenaltyRulesetCsv(csv, {
      code: 'alphanum_test',
      name: 'Alphanumeric REF test',
      version: '1',
      accumulationScope: 'match',
      builtIn: false,
    });

    expect(parsed.entries[0]?.refNumber).toBe('R7a');
  });

  it('parses the FFAMHE semicolon CSV and normalizes French sanctions', () => {
    const csv = [
      'Group;Ref Number;short name;Nature de la faute;sanction 1;sanction 2;sanction 3;sanction 4;;;;',
      '1;1;Sortie de Lice;Sortir involontairement la zone de combat;Jaune;Rouge;Rouge;Noir;;;;',
    ].join('\n');

    const parsed = parsePenaltyRulesetCsv(csv, {
      code: 'ffamhe_tf_2026',
      name: 'Penalty - Tournois fédéraux FFAMHE',
      version: '1.0.0',
      accumulationScope: 'match',
      builtIn: true,
    });

    expect(parsed.entries).toEqual([
      {
        groupNumber: 1,
        refNumber: '1',
        shortName: 'Sortie de Lice',
        description: 'Sortir involontairement la zone de combat',
        sanctions: ['yellow', 'red', 'red', 'black'],
      },
    ]);
  });

  it('escalates only faults in the same group', () => {
    const entry = {
      groupNumber: 3,
      refNumber: '6',
      shortName: 'Non-combativité',
      description: 'Absence d’action offensive',
      sanctions: ['yellow', 'red', 'red', 'black'] as const,
    };

    const sanction = computePenaltySanction(entry, [
      { registrationId: 'fighter-1', groupNumber: 3, card: 'yellow', source: 'ruleset' },
      { registrationId: 'fighter-1', groupNumber: 2, card: 'yellow', source: 'ruleset' },
    ]);

    expect(sanction.card).toBe('red');
    expect(sanction.groupOccurrence).toBe(2);
  });

  it('does not count direct-card overrides in group escalation', () => {
    const entry = {
      groupNumber: 3,
      refNumber: '6',
      shortName: 'Non-combativité',
      description: 'Absence d’action offensive',
      sanctions: ['yellow', 'red', 'red', 'black'] as const,
    };

    const sanction = computePenaltySanction(entry, [
      { registrationId: 'fighter-1', card: 'red', source: 'direct' },
    ]);

    expect(sanction.card).toBe('yellow');
    expect(sanction.groupOccurrence).toBe(1);
  });

  it('maps card consequences without clamping red-card score deltas', () => {
    expect(normalizePenaltyCard('Noir')).toBe('black');
    expect(penaltyScoreDelta('yellow')).toBe(0);
    expect(penaltyScoreDelta('red')).toBe(-1);
    expect(penaltyScoreDelta('black')).toBe(0);
  });
});
