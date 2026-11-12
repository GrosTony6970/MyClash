import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createTranslator, getMessages, type Locale } from '@myclash/i18n';
import type { PublicSparLine } from '@myclash/types';
import { SparredLine } from './SparredLine';

/** What a visitor reads under a fighter's name. */
function render(line: PublicSparLine | null, locale: Locale = 'en') {
  const t = createTranslator(getMessages(locale));
  return renderToStaticMarkup(<SparredLine line={line} t={t} locale={locale} />);
}

describe('SparredLine', () => {
  it('says nothing for no line', () => {
    expect(render(null)).toBe('');
  });

  it('says nothing for no spar and no stars', () => {
    expect(render({ sparred: 0, stars: null })).toBe('');
  });

  it('says "Sparred 1 time" and "Sparred 12 times"', () => {
    expect(render({ sparred: 1, stars: null })).toContain('Sparred 1 time<');
    expect(render({ sparred: 12, stars: null })).toContain('Sparred 12 times<');
  });

  it('adds the stars with the locale decimal separator', () => {
    const line = { sparred: 7, stars: { average: 4.3, count: 7 } };
    expect(render(line)).toContain('Sparred 7 times · ★ 4.3 (7)');
    expect(render(line, 'fr')).toContain('★ 4,3 (7)');
  });
});
