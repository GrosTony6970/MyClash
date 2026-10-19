import { describe, it, expect } from 'vitest';
import { createTranslator, getMessages } from '@myclash/i18n';
import type { RulesChangeNotice } from '@myclash/types';
import { rulesChangesNoticeItems } from './rules-changes-notice';

const en = createTranslator(getMessages('en'));
const fr = createTranslator(getMessages('fr'));
const PARIS = { locale: 'en' as const, timezone: 'Europe/Paris' };

function notice(over: Partial<RulesChangeNotice>): RulesChangeNotice {
  return {
    kind: 'ruleset',
    changedAt: '2026-10-19T12:05:00.000Z',
    sameRuleset: true,
    fromLabel: 'TF_v1',
    fromVersion: '1.0.0',
    toLabel: 'TF_v1',
    toVersion: '1.1.0',
    justification: 'The federation published a new edition.',
    changes: [],
    privateFormula: false,
    ...over,
  };
}

describe('rulesChangesNoticeItems', () => {
  it('shows nothing when the rules never changed', () => {
    expect(rulesChangesNoticeItems([], en, PARIS)).toEqual([]);
  });

  it('lists every change, newest first, whatever order it is given in', () => {
    const items = rulesChangesNoticeItems(
      [
        notice({ changedAt: '2026-10-18T09:00:00.000Z', justification: 'first' }),
        notice({ changedAt: '2026-10-19T09:00:00.000Z', justification: 'third' }),
        notice({ changedAt: '2026-10-18T15:00:00.000Z', justification: 'second' }),
      ],
      en,
      PARIS,
    );
    expect(items.map((item) => item.reason)).toEqual([
      'Reason: third',
      'Reason: second',
      'Reason: first',
    ]);
  });

  it('names a move inside one ruleset once, with both versions, and its "how a bout ends" line', () => {
    const [item] = rulesChangesNoticeItems(
      [notice({ changes: [{ path: 'engine', before: '1.0.0', after: '1.1.0', locked: true }] })],
      en,
      PARIS,
    );
    expect(item!.title).toBe('Ruleset changed');
    expect(item!.rules).toBe('TF_v1 1.0.0 → 1.1.0');
    expect(item!.lines).toEqual(['How a bout ends changed']);
    expect(item!.reason).toBe('Reason: The federation published a new edition.');
  });

  it('names both sides of a move to another ruleset', () => {
    const [item] = rulesChangesNoticeItems(
      [notice({ sameRuleset: false, toLabel: 'Generic points cap', toVersion: '2.0.0' })],
      en,
      PARIS,
    );
    expect(item!.rules).toBe('TF_v1 1.0.0 → Generic points cap 2.0.0');
  });

  it('names both sides of a move between two rulesets that share a name', () => {
    const fork = 'TF_v1 (customised)';
    const [item] = rulesChangesNoticeItems(
      [notice({ sameRuleset: false, fromLabel: fork, toLabel: fork, toVersion: '1.0.0' })],
      en,
      PARIS,
    );
    expect(item!.rules).toBe(`${fork} 1.0.0 → ${fork} 1.0.0`);
  });

  it('shows a settings change on its one ruleset, with the values before and after', () => {
    const [item] = rulesChangesNoticeItems(
      [
        notice({
          kind: 'settings',
          toVersion: '1.0.0',
          changes: [{ path: 'matchFormat.pointCap', before: 5, after: 7, locked: true }],
        }),
      ],
      en,
      PARIS,
    );
    expect(item!.title).toBe('Settings changed');
    expect(item!.rules).toBe('TF_v1 1.0.0');
    expect(item!.lines).toEqual(['Point cap: 5 → 7']);
  });

  it("words a club formula's own changes as one line, with no value", () => {
    const [item] = rulesChangesNoticeItems(
      [
        notice({
          fromLabel: 'Club rules',
          toLabel: 'Club rules',
          privateFormula: true,
          changes: [
            { path: 'scoreFormula', before: null, after: null, locked: true },
            { path: 'constants', before: null, after: null, locked: true },
            { path: 'matchFormat.pointCap', before: 5, after: 7, locked: true },
          ],
        }),
      ],
      en,
      PARIS,
    );
    expect(item!.lines).toEqual(['The scoring formula changed', 'Point cap: 5 → 7']);
  });

  it("dates each change in the Event's timezone", () => {
    const [item] = rulesChangesNoticeItems([notice({})], en, PARIS);
    expect(item!.when).toMatch(/^Changed on 19 October 2026.*14:05$/);
  });

  it('speaks French', () => {
    const [item] = rulesChangesNoticeItems(
      [
        notice({
          kind: 'settings',
          toVersion: '1.0.0',
          justification: 'Erreur de saisie.',
          changes: [{ path: 'matchFormat.pointCap', before: 5, after: 7, locked: true }],
        }),
      ],
      fr,
      { locale: 'fr', timezone: 'Europe/Paris' },
    );
    expect(item!.title).toBe('Réglages modifiés');
    expect(item!.lines).toEqual(['Plafond de points : 5 → 7']);
    expect(item!.reason).toBe('Motif : Erreur de saisie.');
    expect(item!.when).toMatch(/^Modifié le 19 octobre 2026.*14:05$/);
  });
});
