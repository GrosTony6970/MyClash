import { describe, expect, it } from 'vitest';
import { createTranslator, getMessages } from '@myclash/i18n';
import { boutTitle, eventTitles, siteTitles } from './page-title';

/**
 * What a browser tab reads (quick wins F15, F16; operator ruling 2026-10-13:
 * the page, then the Event; "MyClash" only outside an Event).
 */
const fill = (rule: { template: string }, page: string) => rule.template.replace('%s', page);

describe('the rule of a tab title', () => {
  it('outside an Event: the page, then the site', () => {
    expect(fill(siteTitles('MyClash'), 'Leagues')).toBe('Leagues · MyClash');
    expect(siteTitles('MyClash').default).toBe('MyClash');
  });

  it('inside an Event: the page, then the Event, and no site name', () => {
    const rule = eventTitles('FAL 2026');
    expect(fill(rule, 'Longsword Open')).toBe('Longsword Open · FAL 2026');
    // A page with no words of its own reads the Event alone: `absolute` keeps the root's
    // template off it, where `default` got "FAL 2026 · MyClash".
    expect(rule).toEqual({ template: '%s · FAL 2026', absolute: 'FAL 2026' });
    expect(JSON.stringify(rule)).not.toContain('MyClash');
  });
});

describe("a bout's own words", () => {
  const en = createTranslator(getMessages('en'));
  const fr = createTranslator(getMessages('fr'));

  it('names its two fighters', () => {
    expect(boutTitle({ redName: 'Dupont', blueName: 'Martin', label: 'L1-P2-M03' }, en)).toBe(
      'Dupont vs Martin',
    );
  });

  it.each([
    ['', 'Martin'],
    ['Dupont', ''],
    ['  ', 'Martin'],
  ])('with a fighter missing (%j, %j) it reads its number', (redName, blueName) => {
    expect(boutTitle({ redName, blueName, label: 'L1-P2-M03' }, en)).toBe('Match L1-P2-M03');
  });

  it('with no name and no number it still reads something, in the visitor’s language', () => {
    expect(boutTitle({ redName: '', blueName: '', label: undefined }, en)).toBe('Match');
    expect(boutTitle({ redName: '', blueName: '', label: null }, fr)).toBe('Match');
    expect(boutTitle({ redName: '', blueName: '', label: '7' }, fr)).toBe('Match 7');
  });
});
