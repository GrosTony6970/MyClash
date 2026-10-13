import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isOwnSitePath } from '@myclash/types';
import { backLabelKey, boutPageHref, boutPagePath } from './bout-page';

describe('boutPageHref', () => {
  it("is the bout's page, with where its Back link returns", () => {
    expect(boutPageHref('open-2027', 'm-1', '/e/open-2027/my-schedule')).toBe(
      '/e/open-2027/match/m-1?return=%2Fe%2Fopen-2027%2Fmy-schedule',
    );
  });

  it('keeps a return with a fragment whole', () => {
    const href = boutPageHref('open-2027', 'm-1', '/e/open-2027/t/longsword#poolmatches');
    expect(new URL(href, 'https://x.test').searchParams.get('return')).toBe(
      '/e/open-2027/t/longsword#poolmatches',
    );
  });

  it('gives a return the bout page keeps', () => {
    const href = boutPageHref('open-2027', 'm-1', '/e/open-2027/my-schedule');
    expect(isOwnSitePath(new URL(href, 'https://x.test').searchParams.get('return'))).toBe(true);
  });
});

describe('boutPagePath', () => {
  it("is the bout's plain address: what Share sends, with no way back in it", () => {
    expect(boutPagePath('open-2027', 'm-1')).toBe('/e/open-2027/match/m-1');
  });

  it('is where boutPageHref starts', () => {
    expect(boutPageHref('open-2027', 'm-1', '/x').split('?')[0]).toBe(
      boutPagePath('open-2027', 'm-1'),
    );
  });
});

describe('backLabelKey', () => {
  it('names the Event home when no return was given', () => {
    expect(backLabelKey(null, 'open-2027')).toBe('publicApp.tournament.backToEventHome');
  });

  it("names the list of bouts for a return to a Tournament's page", () => {
    expect(backLabelKey('/e/open-2027/t/longsword#poolmatches', 'open-2027')).toBe(
      'scoring.lice.backToMatchList',
    );
  });

  it('is a plain "Back" for a return to a schedule', () => {
    expect(backLabelKey('/e/open-2027/my-schedule', 'open-2027')).toBe('actions.back');
    expect(backLabelKey('/me/events/open-2027/schedule', 'open-2027')).toBe('actions.back');
  });

  it('is a plain "Back" for another Event\'s Tournament page', () => {
    expect(backLabelKey('/e/other/t/longsword', 'open-2027')).toBe('actions.back');
  });
});

/**
 * web-public's vitest does not compile TSX, and the bout page reads on the
 * server: its wiring, and that of the three senders, is pinned as text.
 */
describe('one builder and one wording', () => {
  const app = join(__dirname, '..', '..', 'app', 'e', '[eventSlug]');
  const read = (...path: string[]) => readFileSync(join(...path), 'utf8');

  it('the bout page words its Back link by backLabelKey', () => {
    expect(read(app, 'match', '[matchId]', 'page.tsx')).toContain(
      'backLabelKey={backLabelKey(validReturn, eventSlug)}',
    );
    expect(read(app, 'match', '[matchId]', 'match-live-view.tsx')).toContain(
      'label={t(backLabelKey)}',
    );
  });

  it('the bout page shares its plain address, and not a bout the public cannot read', () => {
    expect(read(app, 'match', '[matchId]', 'page.tsx')).toContain(
      'sharePath={boutPagePath(eventSlug, matchId)}',
    );
    expect(read(app, 'match', '[matchId]', 'match-live-view.tsx')).toContain(
      '{!match.hiddenFromPublic && <ShareButton path={sharePath} />}',
    );
  });

  it.each([
    ['the guest schedule', join(app, 'my-schedule', 'page.tsx')],
    ["a person's page", join(app, 'people', '[personId]', 'page.tsx')],
    ['the pool list', join(app, 't', '[tournamentSlug]', 'PoolMatchesView.tsx')],
    ['the signed-in schedule', join(__dirname, '..', 'components', 'me', 'ScheduleView.tsx')],
  ])('%s builds the address with boutPageHref', (_name, path) => {
    const source = read(path);
    expect(source).toContain('boutPageHref(');
    expect(source).not.toContain('?return=');
  });
});
