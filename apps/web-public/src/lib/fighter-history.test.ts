import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { historyBoutHref, historyDay } from './fighter-history';

describe('historyBoutHref', () => {
  it("is the bout's page, and its Back link returns to the fighter", () => {
    expect(historyBoutHref({ id: 'm-1', eventSlug: 'open-2027' }, 'lea-martin')).toBe(
      '/e/open-2027/match/m-1?return=%2Ffighters%2Flea-martin',
    );
  });

  it('is null for a line with no Event address: there is no page to open', () => {
    expect(historyBoutHref({ id: 'm-1', eventSlug: '' }, 'lea-martin')).toBeNull();
    expect(historyBoutHref({ id: 'm-1', eventSlug: null }, 'lea-martin')).toBeNull();
    // An API that predates the field.
    expect(historyBoutHref({ id: 'm-1' }, 'lea-martin')).toBeNull();
  });
});

describe('historyDay', () => {
  it("words the Event's first day in the visitor's language", () => {
    expect(historyDay('2026-03-14', 'en')).toBe('14 Mar 2026');
    expect(historyDay('2026-03-14', 'fr')).toBe('14 mars 2026');
  });

  it('never slips a day, on the first and on the last day of a year', () => {
    // A plain day read as a local midnight shows the day before, west of Greenwich.
    expect(historyDay('2026-01-01', 'en')).toBe('1 Jan 2026');
    expect(historyDay('2026-12-31', 'en')).toBe('31 Dec 2026');
  });

  it('is empty when the Event has no day', () => {
    expect(historyDay('', 'en')).toBe('');
    expect(historyDay('not a day', 'en')).toBe('');
  });
});

/** web-public's vitest does not compile TSX: the two callers are pinned as text. */
describe('one builder for a bout a fighter page opens', () => {
  const page = join(__dirname, '..', '..', 'app', 'fighters', '[slug]');
  const read = (...path: string[]) => readFileSync(join(page, ...path), 'utf8');

  it('the full history opens a bout by historyBoutHref, and shows historyDay', () => {
    const modal = read('_components', 'MatchHistoryModal.tsx');
    expect(modal).toContain('historyBoutHref(match, slug)');
    expect(modal).toContain('historyDay(match.eventDate, locale)');
  });

  it('the recent results and the live bout open a bout by historyBoutHref', () => {
    const source = read('page.tsx');
    expect(source.split('historyBoutHref(match, fighter.slug)').length - 1).toBe(2);
    expect(source).not.toContain('/match/${match.id}');
  });
});
