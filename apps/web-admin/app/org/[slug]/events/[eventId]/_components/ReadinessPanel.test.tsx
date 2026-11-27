import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import type { ReadinessCheck } from '../readiness-copy';
import { ReadinessRow } from './ReadinessPanel';

/**
 * One readiness row, as Start of day and the Event overview both draw it: the level must read
 * at a glance, by a solid mark and a flag on the rows with work left.
 */
vi.mock('next/link', () => ({
  default: ({
    href,
    className,
    children,
  }: {
    href: string;
    className?: string;
    children?: ReactNode;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const render = (check: ReadinessCheck, locale: 'en' | 'fr' = 'en') =>
  renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <ul>
        <ReadinessRow check={check} slug="club" eventId="ev1" />
      </ul>
    </I18nProvider>,
  );

const POOLS_OK: ReadinessCheck = {
  key: 'pools',
  level: 'ok',
  tournamentId: 't1',
  values: { count: 4 },
};
const REFEREES_WARN: ReadinessCheck = {
  key: 'poolReferees',
  level: 'warn',
  tournamentId: 't1',
  values: { missing: 2, total: 4 },
};

describe('ReadinessRow', () => {
  it('draws a solid mark with a glyph, named for screen readers', () => {
    const html = render(POOLS_OK);
    expect(html).toMatch(/role="img" aria-label="[^"]+"/);
    expect(html).toContain('bg-success');
    expect(html).toContain('✓');
  });

  it('flags a row with work left and makes its Fix link a button', () => {
    const html = render(REFEREES_WARN);
    expect(html).toContain('border-l-warning');
    expect(html).toContain('bg-warning/5');
    expect(html).toMatch(/<a [^>]*class="[^"]*border-accent[^"]*"[^>]*>Fix<\/a>/);
  });

  it('puts the message of a flagged row in the secondary ink, never the muted one', () => {
    // The muted ink is under 4.5:1 on a wash (known-deviations D35).
    const html = render(REFEREES_WARN);
    expect(html).toContain('text-foreground-secondary');
    expect(html).not.toContain('text-muted');
  });

  it("shows the Tournament's name only when it is given one", () => {
    const tagged = renderToStaticMarkup(
      <I18nProvider locale="en">
        <ul>
          <ReadinessRow check={POOLS_OK} slug="club" eventId="ev1" tournamentName="Rapier" />
        </ul>
      </I18nProvider>,
    );
    expect(tagged).toContain('>Rapier</span>');
    expect(render(POOLS_OK)).not.toContain('Rapier');
  });

  it('leaves a cleared row unflagged, with a plain View link', () => {
    const html = render(POOLS_OK);
    expect(html).not.toContain('border-l-4');
    expect(html).toMatch(/<a [^>]*class="[^"]*hover:underline[^"]*"[^>]*>View<\/a>/);
  });
});
