import { describe, expect, it } from 'vitest';
import { groupByPiste, pisteSheetHtml } from './piste-sheet';
import type { PrintLabels, PrintMatch, PrintTournamentMeta } from './print-types';

/**
 * The piste day-sheet: what order a piste's bouts come out in, and what clock
 * they are printed on.
 *
 * Split from `print-pack.test.ts` when the two together crossed the 400-line
 * file cap. The line is the source files': this covers `piste-sheet.ts`, that
 * one covers the adapters and the pack assembly.
 */
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
  time: 'Heure',
  generatedAt: 'Généré le',
  red: 'Rouge',
  blue: 'Bleu',
  notes: 'Notes',
};

const META: PrintTournamentMeta = {
  eventName: 'FAL 2026',
  tournamentName: 'Longsword Open',
  rulesetLabel: 'TF_v1 1.0.0',
  sideColors: { red: '#15803d', blue: '#7e22ce' },
  generatedAt: '04/08/2026 09:00',
  // A THIRD zone, on purpose. This machine, the default event zone and the drag
  // fixture are all Europe/Paris, so a Paris event asserted from a Paris box
  // cannot tell a correct conversion from no conversion at all.
  timeZone: 'America/New_York',
};

describe('groupByPiste', () => {
  it('keeps generation order when nothing on the piste has a time yet', () => {
    const matches: PrintMatch[] = [
      {
        roundCode: 'A',
        redName: 'a',
        blueName: 'b',
        redClub: null,
        blueClub: null,
        liceName: 'Piste 1',
        scheduledAt: null,
        referees: [],
      },
      {
        roundCode: 'B',
        redName: 'c',
        blueName: 'd',
        redClub: null,
        blueClub: null,
        liceName: null,
        scheduledAt: null,
        referees: [],
      },
      {
        roundCode: 'C',
        redName: 'e',
        blueName: 'f',
        redClub: null,
        blueClub: null,
        liceName: 'Piste 1',
        scheduledAt: null,
        referees: [],
      },
    ];
    const groups = groupByPiste(matches, LABELS.unassigned);
    expect(groups.map((g) => g.liceName)).toEqual(['Piste 1', 'Non attribué']);
    expect(groups[0]?.matches.map((m) => m.roundCode)).toEqual(['A', 'C']);
  });

  /** A bout on a piste, at a time. The only two fields this suite sorts on. */
  function placed(roundCode: string, liceName: string | null, scheduledAt: string | null) {
    return {
      roundCode,
      redName: 'a',
      blueName: 'b',
      redClub: null,
      blueClub: null,
      liceName,
      scheduledAt,
      referees: [],
    };
  }

  /**
   * THE POINT OF THE SLICE. The sheet used to list a piste's bouts in the order
   * they were GENERATED — pools, then bracket rounds. Once they have times that
   * is not the order they will be fought, and the person reading a sheet taped
   * to the piste table is looking for what happens next.
   */
  it('puts a piste in clock order, not the order the bouts were generated', () => {
    const groups = groupByPiste(
      [
        placed('pool-late', 'Piste 1', '2026-06-06T16:00:00.000Z'),
        placed('pool-early', 'Piste 1', '2026-06-06T09:00:00.000Z'),
        placed('final', 'Piste 1', '2026-06-06T12:00:00.000Z'),
      ],
      LABELS.unassigned,
    );

    expect(groups[0]?.matches.map((m) => m.roundCode)).toEqual([
      'pool-early',
      'final',
      'pool-late',
    ]);
  });

  /**
   * A bout nobody has placed is not "at 00:00". Sorting it to the top would put
   * the least certain rows where the eye goes first.
   */
  it('puts the bouts with no time last, in the order they arrived', () => {
    const groups = groupByPiste(
      [
        placed('no-time-1', 'Piste 1', null),
        placed('timed', 'Piste 1', '2026-06-06T16:00:00.000Z'),
        placed('no-time-2', 'Piste 1', null),
      ],
      LABELS.unassigned,
    );

    expect(groups[0]?.matches.map((m) => m.roundCode)).toEqual(['timed', 'no-time-1', 'no-time-2']);
  });

  it('keeps the order given for two bouts sharing a minute', () => {
    const sameMinute = '2026-06-06T09:00:00.000Z';
    const groups = groupByPiste(
      [placed('second', 'Piste 1', sameMinute), placed('first', 'Piste 1', sameMinute)],
      LABELS.unassigned,
    );

    expect(groups[0]?.matches.map((m) => m.roundCode)).toEqual(['second', 'first']);
  });

  it('sorts each piste on its own', () => {
    const groups = groupByPiste(
      [
        placed('p1-late', 'Piste 1', '2026-06-06T16:00:00.000Z'),
        placed('p2-late', 'Piste 2', '2026-06-06T17:00:00.000Z'),
        placed('p1-early', 'Piste 1', '2026-06-06T09:00:00.000Z'),
        placed('p2-early', 'Piste 2', '2026-06-06T10:00:00.000Z'),
      ],
      LABELS.unassigned,
    );

    expect(groups[0]?.matches.map((m) => m.roundCode)).toEqual(['p1-early', 'p1-late']);
    expect(groups[1]?.matches.map((m) => m.roundCode)).toEqual(['p2-early', 'p2-late']);
  });
});

describe('pisteSheetHtml — the time column', () => {
  function sheet(scheduledAt: string | null, timeZone = META.timeZone): string {
    return pisteSheetHtml(
      {
        liceName: 'Piste 1',
        matches: [
          {
            roundCode: 'LSW-P1-M1',
            redName: 'a',
            blueName: 'b',
            redClub: null,
            blueClub: null,
            liceName: 'Piste 1',
            scheduledAt,
            referees: [],
          },
        ],
      },
      { ...META, timeZone },
      LABELS,
    );
  }

  /**
   * THE TIMEZONE TRAP. This machine, the default event zone and the drag
   * fixture are all Europe/Paris, so a Paris assertion run on a Paris box
   * cannot tell a correct conversion from no conversion at all. 14:30Z is 16:30
   * in Paris and 10:30 in New York — three different answers, so each pins the
   * zone that actually produced it.
   */
  it('renders the time on the EVENT clock, not UTC and not this machine', () => {
    expect(sheet('2026-06-06T14:30:00.000Z', 'America/New_York')).toContain('10:30');
    expect(sheet('2026-06-06T14:30:00.000Z', 'Europe/Paris')).toContain('16:30');
    expect(sheet('2026-06-06T14:30:00.000Z', 'Australia/Sydney')).toContain('00:30');
  });

  it('renders a bout with no time as a dash rather than an empty cell', () => {
    expect(sheet(null)).toContain('<td>—</td>');
  });

  it('heads the column with the caller-supplied label', () => {
    expect(sheet(null)).toContain('>Heure</th>');
  });
});
