import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createTranslator, getMessages, type Locale } from '@myclash/i18n';
import { capacityBadge } from './WorkshopCard';

/** The text of the seats pill a reader sees on a workshop card. */
function badge(confirmed: number, capacity: number, locale: Locale = 'en'): string {
  const t = createTranslator(getMessages(locale));
  const node: ReactNode = capacityBadge(confirmed, capacity, t);
  return renderToStaticMarkup(<>{node}</>).replace(/<[^>]+>/g, '');
}

describe('capacityBadge', () => {
  it('says how many seats are left when the workshop is almost full', () => {
    expect(badge(8, 10)).toBe('Almost full · 2 spots');
    expect(badge(8, 10, 'fr')).toBe('Presque complet · 2 places');
  });

  it('says one seat in the singular', () => {
    expect(badge(9, 10)).toBe('Almost full · 1 spot');
    expect(badge(9, 10, 'fr')).toBe('Presque complet · 1 place');
    expect(badge(3, 4)).toBe('1 spot left');
    expect(badge(3, 4, 'fr')).toBe('1 place restante');
  });

  it('counts the seats left below the almost-full mark', () => {
    expect(badge(2, 10)).toBe('8 spots left');
    expect(badge(2, 10, 'fr')).toBe('8 places restantes');
  });

  it('says full when no seat is left', () => {
    expect(badge(10, 10)).toBe('Full');
    expect(badge(10, 10, 'fr')).toBe('Complet');
  });
});
