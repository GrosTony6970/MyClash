import { describe, expect, it } from 'vitest';
import {
  allMatchesOf,
  bracketToPrint,
  poolsToPrint,
  type ApiBracketSlot,
  type ApiPoolWithMatches,
} from './build-print-data';
import { groupByPiste } from './piste-sheet';
import { printPackHtml } from './print-pack';
import type { PrintLabels, PrintMatch, PrintTournamentMeta } from './print-types';

const LABELS: PrintLabels = {
  poolSheet: 'Feuille de poule',
  scoresheet: 'Feuille de match',
  pisteSheet: 'Feuille de piste',
  bracketSheet: 'Tableau',
  fighter: 'Combattant',
  club: 'Club',
  bout: 'Combats',
  piste: 'Piste',
  referee: 'Arbitre',
  unassigned: 'Non attribué',
  score: 'Score',
  exchanges: 'Échanges',
  doubles: 'Coups doubles',
  penalties: 'Pénalités',
  winner: 'Vainqueur',
  signature: 'Signature',
  round: 'Combat',
  generatedAt: 'Généré le',
  red: 'Rouge',
  blue: 'Bleu',
  notes: 'Notes',
};

const META: PrintTournamentMeta = {
  eventName: 'FAL 2026',
  tournamentName: 'Longsword Open',
  rulesetLabel: 'TF_v1 1.0.0',
  // Deliberately NOT red/blue: the organiser configured green/purple, and the
  // paper has to agree with the hall screen.
  sideColors: { red: '#15803d', blue: '#7e22ce' },
  generatedAt: '04/08/2026 09:00',
};

const LICES = new Map([
  ['lice-1', 'Piste 1'],
  ['lice-2', 'Piste 2'],
]);

function apiPool(overrides: Partial<ApiPoolWithMatches> = {}): ApiPoolWithMatches {
  return {
    poolId: 'pool-1',
    poolName: 'Pool A',
    matches: [
      {
        id: 'm1',
        round_number: 1,
        red_name: 'Jean Dupont',
        blue_name: 'Marie Martin',
        red_club_abbrev: 'LYA',
        blue_club_abbrev: null,
        red_registration_id: 'r1',
        blue_registration_id: 'r2',
        lice_id: 'lice-1',
        roundCode: 'LSW-P1-M1',
        referees: [{ refereeName: 'Paul Durand' }],
      },
      {
        id: 'm2',
        round_number: 2,
        red_name: 'Jean Dupont',
        blue_name: 'Luc Bernard',
        red_club_abbrev: 'LYA',
        blue_club_abbrev: 'PAR',
        red_registration_id: 'r1',
        blue_registration_id: 'r3',
        lice_id: null,
        roundCode: 'LSW-P1-M2',
        referees: [],
      },
    ],
    ...overrides,
  };
}

describe('poolsToPrint', () => {
  it('derives the roster from the bouts, deduped and in first-appearance order', () => {
    const [pool] = poolsToPrint([apiPool()], LICES);
    expect(pool?.fighters).toEqual([
      { name: 'Jean Dupont', club: 'LYA' },
      { name: 'Marie Martin', club: null },
      { name: 'Luc Bernard', club: 'PAR' },
    ]);
  });

  it('resolves lice ids to names', () => {
    const [pool] = poolsToPrint([apiPool()], LICES);
    expect(pool?.matches[0]?.liceName).toBe('Piste 1');
  });

  it('renders an unknown lice id as unplaced rather than leaking the id', () => {
    // A raw UUID on a sheet handed to a scorekeeper tells them nothing and
    // reads as a bug — see the no-raw-ids rule.
    const pool = apiPool();
    pool.matches[0]!.lice_id = 'lice-that-was-deleted';
    const [printed] = poolsToPrint([pool], LICES);
    expect(printed?.matches[0]?.liceName).toBeNull();
  });
});

describe('bracketToPrint', () => {
  const slots: ApiBracketSlot[] = [
    { round: 2, position: 1, redFighterName: 'A', blueFighterName: null, roundCode: 'F' },
    { round: 1, position: 2, redFighterName: 'C', blueFighterName: 'D', roundCode: 'SF2' },
    { round: 1, position: 1, redFighterName: 'A', blueFighterName: 'B', roundCode: 'SF1' },
  ];

  it('groups by round, ordered, with slots sorted by position', () => {
    const rounds = bracketToPrint(slots, 2, LICES, (round) => `R${round}`);
    expect(rounds.map((r) => r.roundName)).toEqual(['R1', 'R2']);
    expect(rounds[0]?.matches.map((m) => m.roundCode)).toEqual(['SF1', 'SF2']);
  });

  it('renders an empty side as a placeholder, never as "null"', () => {
    const rounds = bracketToPrint(slots, 2, LICES, (round) => `R${round}`);
    expect(rounds[1]?.matches[0]?.blueName).toBe('—');
  });

  it('falls back to a positional code when the slot carries none', () => {
    const rounds = bracketToPrint(
      [{ round: 1, position: 3, redFighterName: 'X', blueFighterName: 'Y' }],
      1,
      LICES,
      () => 'Final',
    );
    expect(rounds[0]?.matches[0]?.roundCode).toBe('R1-3');
  });
});

describe('groupByPiste', () => {
  it('keeps the order it was given and buckets unplaced bouts separately', () => {
    const matches: PrintMatch[] = [
      {
        roundCode: 'A',
        redName: 'a',
        blueName: 'b',
        redClub: null,
        blueClub: null,
        liceName: 'Piste 1',
        referees: [],
      },
      {
        roundCode: 'B',
        redName: 'c',
        blueName: 'd',
        redClub: null,
        blueClub: null,
        liceName: null,
        referees: [],
      },
      {
        roundCode: 'C',
        redName: 'e',
        blueName: 'f',
        redClub: null,
        blueClub: null,
        liceName: 'Piste 1',
        referees: [],
      },
    ];
    const groups = groupByPiste(matches, LABELS.unassigned);
    expect(groups.map((g) => g.liceName)).toEqual(['Piste 1', 'Non attribué']);
    expect(groups[0]?.matches.map((m) => m.roundCode)).toEqual(['A', 'C']);
  });
});

describe('printPackHtml', () => {
  const pools = poolsToPrint([apiPool()], LICES);
  const bracketRounds = bracketToPrint(
    [{ round: 1, position: 1, redFighterName: 'A', blueFighterName: 'B', roundCode: 'F' }],
    1,
    LICES,
    () => 'Finale',
  );
  const allMatches = allMatchesOf(pools, bracketRounds);

  function render(sections: Parameters<typeof printPackHtml>[0]['sections']) {
    return printPackHtml({
      meta: META,
      labels: LABELS,
      pools,
      bracketRounds,
      allMatches,
      sections,
    });
  }

  it('emits one sheet per pool and nothing else when only pools are selected', () => {
    const html = render(['pools']);
    expect(html.match(/class="sheet"/g)).toHaveLength(1);
    expect(html).toContain('Feuille de poule — Pool A');
    expect(html).not.toContain('Feuille de match');
  });

  it('uses the labels it is given — no English leaks onto the paper', () => {
    const html = render(['pools', 'bracket', 'pistes', 'scoresheets']);
    for (const header of ['Combattant', 'Arbitre', 'Vainqueur', 'Échanges', 'Coups doubles']) {
      expect(html).toContain(header);
    }
    // The bug this whole labels object exists to prevent.
    expect(html).not.toContain('>Fighter<');
    expect(html).not.toContain('>Exchanges<');
  });

  it("paints corners in the organiser's configured colours", () => {
    const html = render(['pools']);
    expect(html).toContain('background:#15803d');
    expect(html).toContain('background:#7e22ce');
    // The fallback that has bitten this codebase before.
    expect(html).not.toContain('background:#ef4444');
  });

  it('emits one scoresheet per bout, across pools and bracket', () => {
    const html = render(['scoresheets']);
    expect(html.match(/class="sheet"/g)).toHaveLength(allMatches.length);
  });

  it('never ends on a page break, so the pack has no trailing blank page', () => {
    const html = render(['pools', 'scoresheets']);
    expect(html).toContain('.sheet:last-child { page-break-after: auto; }');
  });

  it('escapes a name that would otherwise break the document', () => {
    const nasty = apiPool();
    nasty.matches[0]!.red_name = '<script>alert(1)</script>';
    const html = printPackHtml({
      meta: META,
      labels: LABELS,
      pools: poolsToPrint([nasty], LICES),
      bracketRounds: [],
      allMatches: [],
      sections: ['pools'],
    });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('produces an empty body when nothing is selected', () => {
    const html = render([]);
    expect(html).toContain('<body></body>');
  });
});
