import { describe, expect, it } from 'vitest';
import {
  computePenaltySanction,
  normalizePenaltyCard,
  parsePenaltyRulesetCsv,
  penaltyScoreDelta,
} from './index';

describe('penalty rulesets', () => {
  it('parses the FFAMHE semicolon CSV and normalizes French sanctions', () => {
    const csv = [
      'Group;Ref Number;short name;Nature de la faute;sanction 1;sanction 2;sanction 3;sanction 4;;;;',
      '1;1;Sortie de Lice;Sortir involontairement la zone de combat;Jaune;Rouge;Rouge;Noir;;;;',
    ].join('\n');

    const parsed = parsePenaltyRulesetCsv(csv, {
      code: 'ffamhe_tf_2026',
      name: 'Penalty - Tournois fédéraux FFAMHE',
      version: '2026',
      accumulationScope: 'match',
      builtIn: true,
    });

    expect(parsed.entries).toEqual([
      {
        groupNumber: 1,
        refNumber: 1,
        shortName: 'Sortie de Lice',
        description: 'Sortir involontairement la zone de combat',
        sanctions: ['yellow', 'red', 'red', 'black'],
      },
    ]);
  });

  it('escalates only faults in the same group', () => {
    const entry = {
      groupNumber: 3,
      refNumber: 6,
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
      refNumber: 6,
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
