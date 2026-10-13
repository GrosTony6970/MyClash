import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { errorHome } from './error-home';

const EVENT_HOME = { href: '/e/open-2027/home', labelKey: 'publicApp.eventHome.backToHome' };
const ALL_EVENTS = { href: '/', labelKey: 'publicApp.login.backToEvents' };

describe('errorHome', () => {
  it("leads to the Event's home from a page of an Event", () => {
    expect(errorHome('open-2027', '/e/open-2027/match/m-1')).toEqual(EVENT_HOME);
    expect(errorHome('open-2027', '/e/open-2027/t/longsword')).toEqual(EVENT_HOME);
  });

  it("leads to the list of Events when the Event's own home is the page that failed", () => {
    expect(errorHome('open-2027', '/e/open-2027/home')).toEqual(ALL_EVENTS);
    expect(errorHome('open-2027', '/e/open-2027')).toEqual(ALL_EVENTS);
  });

  it('leads to the list of Events from a page of no Event', () => {
    expect(errorHome(undefined, '/me/security')).toEqual(ALL_EVENTS);
    expect(errorHome(null, null)).toEqual(ALL_EVENTS);
  });

  it("still leads to the Event's home when the page's address is not known", () => {
    expect(errorHome('open-2027', null)).toEqual(EVENT_HOME);
  });
});

/**
 * web-public's vitest compiles no TSX: the three error pages are read as text.
 * `tests/a11y/error-page.spec.ts` opens one through a page that fails.
 */
describe('the three error pages are one card', () => {
  const app = join(__dirname, '..', '..', 'app');
  const pages = [
    ['the Event pages', join(app, 'e', '[eventSlug]', 'error.tsx')],
    ['the bout page', join(app, 'e', '[eventSlug]', 'match', '[matchId]', 'error.tsx')],
    ['the personal space', join(app, 'me', 'error.tsx')],
  ] as const;

  it.each(pages)('%s draws the shared card and nothing of its own', (_name, path) => {
    const source = readFileSync(path, 'utf8');
    expect(source).toContain("'use client';");
    expect(source).toContain('<RouteErrorCard {...props} />');
    expect(source).not.toContain('<button');
    expect(source).not.toContain('<main');
  });

  it('the card offers the retry and the way home, and reports the error once', () => {
    const card = readFileSync(join(__dirname, '..', 'components', 'RouteErrorCard.tsx'), 'utf8');
    expect(card).toContain('const home = errorHome(eventSlug, path);');
    expect(card).toContain('<BackLink href={home.href} label={t(home.labelKey)} />');
    expect(card).toContain('onClick={reset}');
    expect(card.match(/Sentry\.captureException\(error\)/g)).toHaveLength(1);
  });
});
