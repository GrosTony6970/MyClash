import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type * as Ui from '@myclash/ui';
import type { DisplayMatch, Penalty } from '@myclash/ui';
import { BoardRowTimeline } from './BoardRowTimeline';

/**
 * The organiser opens Piste 1's row on the live board while Lyon Blades meets Paris Fencers. Paris
 * took a yellow card for leaving the piste. A team's card names its team, never a Registration,
 * so the timeline places it by the bout's side keys (`redSideId` / `blueSideId`): the card is
 * Paris's, on the blue side, with Paris's chip. A Fighter's card still lands by Registration.
 */
const live = vi.hoisted(() => ({
  match: null as unknown,
  penalties: [] as unknown[],
}));
vi.mock('@myclash/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof Ui>()),
  useLiveMatch: () => ({
    match: live.match,
    exchanges: [],
    penalties: live.penalties,
    protests: [],
    connected: true,
    loadError: null,
  }),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/lib/supabase-browser', () => ({ getSupabaseBrowser: () => ({}) }));

const t = (key: string) => key;

function bout(over: Partial<DisplayMatch>): DisplayMatch {
  return {
    id: 'm1',
    status: 'running',
    matchNumberLabel: 'L1-P1-M01',
    redScore: 0,
    blueScore: 1,
    redSideId: 'reg-red',
    blueSideId: 'reg-blue',
    winnerSideId: null,
    redFighterName: 'Ana Roux',
    blueFighterName: 'Bo Lund',
    redColour: null,
    blueColour: null,
    redLogoUrl: null,
    blueLogoUrl: null,
    startedAt: '2027-06-21T10:00:00.000Z',
    endedAt: null,
    ...over,
  };
}

function card(side: Pick<Penalty, 'registration_id' | 'team_id'>): Penalty {
  return {
    id: 'card-1',
    sequence: 1,
    ...side,
    card: 'yellow',
    source: 'direct',
    short_name: null,
    reason: 'leaves the piste',
    score_delta: 0,
    causes_match_forfeit: false,
    voided: false,
    occurred_at: '2027-06-21T10:01:00.000Z',
  };
}

/** The card's row of the timeline: its name cell, as text. */
function cardRow(): string {
  const html = renderToStaticMarkup(<BoardRowTimeline matchId="m1" t={t} />);
  const row = html.match(/<li[^>]*data-event-number="1"[^>]*>.*?<\/li>/)?.[0];
  expect(row).toBeDefined();
  return row!.replace(/<!-- -->/g, '');
}

describe('the live timeline places a card by side', () => {
  it("puts a team's card on its team's side, with its chip", () => {
    live.match = bout({
      redSideId: 'team-lyon',
      blueSideId: 'team-paris',
      redFighterName: 'Lyon Blades',
      blueFighterName: 'Paris Fencers',
      redColour: 'green',
      blueColour: 'violet',
    });
    live.penalties = [card({ registration_id: null, team_id: 'team-paris' })];

    const row = cardRow();

    expect(row).toContain('Paris Fencers');
    expect(row).not.toContain('Lyon Blades');
    expect(row).toMatch(
      /<span class="inline-flex"><span [^>]*bg-violet[^>]*><\/span><\/span> Paris/,
    );
  });

  it("puts a Fighter's card on the Fighter's side, with no chip", () => {
    live.match = bout({});
    live.penalties = [card({ registration_id: 'reg-red', team_id: null })];

    const row = cardRow();

    expect(row).toContain('Ana Roux');
    expect(row).not.toContain('Bo Lund');
    expect(row).not.toContain('inline-flex');
  });
});
