import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { accentClassFor } from '@myclash/ui';
import { I18nProvider } from '@/i18n/I18nProvider';
import { NOW, mkMatch, mkRow } from '@/lib/live-board/live-board.fixtures';
import { WallRow } from '../../../../../display/wall/[eventId]/WallRow';
import { BoardCard } from './BoardCard';
import { BoardRowView } from './BoardRowView';

/**
 * Lyon Blades (green) meets Paris Fencers (violet) on Piste 1. The organiser's live board, its
 * phone card and the wall on the projector each show the bout in one line: a tight surface, so
 * each team's name with its colour chip before it, and no logo (call 6). A Fighter's side has no
 * colour: no chip, and no stray space.
 */
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const t = (key: string) => key;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const GREEN = escape(accentClassFor('green'));
const VIOLET = escape(accentClassFor('violet'));

const TEAM_BOUT = mkMatch({
  redFighterName: 'Lyon Blades',
  blueFighterName: 'Paris Fencers',
  redColour: 'green',
  blueColour: 'violet',
  redScore: 3,
  blueScore: 2,
});
const FIGHTER_BOUT = mkMatch({ redFighterName: 'Ana Roux', blueFighterName: 'Bo Lund' });

const noop = () => undefined;
const surfaces: Record<string, (row: ReturnType<typeof mkRow>) => ReactElement> = {
  'the board row': (row) => (
    <BoardRowView
      row={row}
      state="synced"
      nowMs={NOW}
      serverNowMs={NOW}
      expanded={false}
      onToggle={noop}
      eventSlug="open"
      accounts={[]}
      onAssignScorer={async () => []}
      readOnly={false}
      slug="club"
      eventId="ev1"
      onAck={noop}
      t={t}
    />
  ),
  'the phone card': (row) => (
    <BoardCard
      row={row}
      state="synced"
      nowMs={NOW}
      serverNowMs={NOW}
      slug="club"
      eventId="ev1"
      onAck={noop}
      readOnly={false}
      t={t}
    />
  ),
  'the wall': (row) => <WallRow row={row} state="synced" nowMs={NOW} locale="en" t={t} />,
};

/** The markup, without the comments React puts between two text nodes. */
function render(surface: string, bout: ReturnType<typeof mkMatch>): string {
  const html = renderToStaticMarkup(
    <I18nProvider locale="en">{surfaces[surface]!(mkRow({ currentMatch: bout }))}</I18nProvider>,
  );
  return html.replace(/<!-- -->/g, '');
}

/** A chip: the dot in its wrapper, then a space. `dark` is the wrapper's scope. */
const chip = (accent: string, dark: boolean) =>
  `<span${dark ? ' data-theme="dark"' : ''} class="inline-flex"><span aria-hidden="true" class="[^"]*${accent}"></span></span> `;

describe.each(Object.keys(surfaces))('%s', (surface) => {
  const dark = surface === 'the wall';

  it("puts each team's chip before its name", () => {
    const html = render(surface, TEAM_BOUT);

    expect(html).toMatch(
      new RegExp(`${chip(GREEN, dark)}Lyon Blades 3–2 ${chip(VIOLET, dark)}Paris Fencers`),
    );
  });

  it('shows no chip and no space for a Fighter', () => {
    const html = render(surface, FIGHTER_BOUT);

    expect(html).toContain('>Ana Roux 0–0 Bo Lund<');
    expect(html).not.toContain('inline-flex');
  });
});
