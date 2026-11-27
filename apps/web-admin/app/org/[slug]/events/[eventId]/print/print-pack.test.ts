import { describe, expect, it } from 'vitest';
import {
  allMatchesOf,
  bracketToPrint,
  poolsToPrint,
  type ApiBracketSlot,
  type ApiPoolWithMatches,
} from './build-print-data';
import { printJoinedPacksHtml, printPackHtml, printPackSheets } from './print-pack';
import type { PrintLabels, PrintTournamentMeta } from './print-types';

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
  unknownReferee: 'Arbitre inconnu',
};

const META: PrintTournamentMeta = {
  eventName: 'FAL 2026',
  tournamentName: 'Longsword Open',
  rulesetLabel: 'TF_v1 1.0.0',
  // Deliberately NOT red/blue: the organiser configured green/purple, and the
  // paper has to agree with the hall screen.
  sideColors: { red: '#15803d', blue: '#7e22ce' },
  generatedAt: '04/08/2026 09:00',
  // A THIRD zone, on purpose. This machine, DEFAULT_EVENT_TIMEZONE and the drag
  // fixture are all Europe/Paris, so a Paris event asserted from a Paris box
  // cannot tell a correct conversion from no conversion at all.
  timeZone: 'America/New_York',
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
        red_team_id: null,
        blue_team_id: null,
        lice_id: 'lice-1',
        scheduled_at: '2026-06-06T14:30:00.000Z',
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
        red_team_id: null,
        blue_team_id: null,
        lice_id: null,
        scheduled_at: null,
        roundCode: 'LSW-P1-M2',
        referees: [],
      },
    ],
    ...overrides,
  };
}

describe('poolsToPrint', () => {
  it('derives the roster from the bouts, deduped and in first-appearance order', () => {
    const [pool] = poolsToPrint([apiPool()], LICES, LABELS.unknownReferee);
    expect(pool?.fighters).toEqual([
      { name: 'Jean Dupont', club: 'LYA' },
      { name: 'Marie Martin', club: null },
      { name: 'Luc Bernard', club: 'PAR' },
    ]);
  });

  it('lists two Fighters who share a name as two, by their side keys', () => {
    const pool = apiPool();
    pool.matches[1]!.blue_name = 'Jean Dupont';
    const [printed] = poolsToPrint([pool], LICES, LABELS.unknownReferee);
    expect(printed?.fighters.map((f) => f.name)).toEqual([
      'Jean Dupont',
      'Marie Martin',
      'Jean Dupont',
    ]);
  });

  it("lists a team Pool's teams once each, by team id (its Registration sides are null)", () => {
    const teamBout = (id: string, red: [string, string], blue: [string, string]) => ({
      ...apiPool().matches[0]!,
      id,
      red_registration_id: null,
      blue_registration_id: null,
      red_team_id: red[0],
      red_name: red[1],
      red_club_abbrev: null,
      blue_team_id: blue[0],
      blue_name: blue[1],
    });
    const lyon: [string, string] = ['team-lyon', 'Lyon Blades'];
    const paris: [string, string] = ['team-paris', 'Paris Rapiers'];
    const metz: [string, string] = ['team-metz', 'Metz Sabres'];
    const pool = apiPool({
      matches: [
        teamBout('m1', lyon, paris),
        teamBout('m2', lyon, metz),
        teamBout('m3', paris, metz),
      ],
    });
    const [printed] = poolsToPrint([pool], LICES, LABELS.unknownReferee);
    expect(printed?.fighters).toEqual([
      { name: 'Lyon Blades', club: null },
      { name: 'Paris Rapiers', club: null },
      { name: 'Metz Sabres', club: null },
    ]);
  });

  it('prints a referee with no name as "unknown referee", never dropped and never an id (X2)', () => {
    const pool = apiPool();
    pool.matches[0]!.referees = [{ refereeName: ' ' }, { refereeName: 'Paul Durand' }];
    const [printed] = poolsToPrint([pool], LICES, LABELS.unknownReferee);
    expect(printed?.matches[0]?.referees).toEqual(['Arbitre inconnu', 'Paul Durand']);
  });

  it('resolves lice ids to names', () => {
    const [pool] = poolsToPrint([apiPool()], LICES, LABELS.unknownReferee);
    expect(pool?.matches[0]?.liceName).toBe('Piste 1');
  });

  /**
   * The API sends the planned start; the piste sheet sorts and prints it. This
   * is the hop between, and it is the one a type change does NOT catch —
   * `scheduledAt` is required on `PrintMatch`, so a hardcoded null compiles.
   */
  it('carries the planned start through, and null for an unplaced bout', () => {
    const [pool] = poolsToPrint([apiPool()], LICES, LABELS.unknownReferee);
    expect(pool?.matches[0]?.scheduledAt).toBe('2026-06-06T14:30:00.000Z');
    expect(pool?.matches[1]?.scheduledAt).toBeNull();
  });

  it('renders an unknown lice id as unplaced rather than leaking the id', () => {
    // A raw UUID on a sheet handed to a scorekeeper tells them nothing and
    // reads as a bug — see the no-raw-ids rule.
    const pool = apiPool();
    pool.matches[0]!.lice_id = 'lice-that-was-deleted';
    const [printed] = poolsToPrint([pool], LICES, LABELS.unknownReferee);
    expect(printed?.matches[0]?.liceName).toBeNull();
  });
});

/** Single-elimination shapes: two fighters (one round), four fighters (two rounds). */
const SINGLE_ELIM_2 = { bracketSize: 2, wbRounds: null, lbRounds: null };
const SINGLE_ELIM_4 = { bracketSize: 4, wbRounds: null, lbRounds: null };

/** A bracket slot as the bracket read sends it: no club, no piste, no clock, no referee. */
function bracketSlot(over: Partial<ApiBracketSlot> = {}): ApiBracketSlot {
  return {
    round: 1,
    position: 1,
    roundCode: 'LSW-B-F-M1',
    redFighterName: 'A',
    blueFighterName: 'B',
    redClubAbbrev: null,
    blueClubAbbrev: null,
    liceId: null,
    scheduledAt: null,
    referees: [],
    ...over,
  };
}

describe('bracketToPrint', () => {
  const slots: ApiBracketSlot[] = [
    bracketSlot({ round: 2, position: 1, blueFighterName: null, roundCode: 'F' }),
    bracketSlot({
      round: 1,
      position: 2,
      redFighterName: 'C',
      blueFighterName: 'D',
      roundCode: 'SF2',
    }),
    bracketSlot({ round: 1, position: 1, roundCode: 'SF1' }),
  ];

  it('groups by round, ordered, with slots sorted by position', () => {
    const rounds = bracketToPrint(
      slots,
      SINGLE_ELIM_4,
      LICES,
      (round) => `R${round}`,
      LABELS.unknownReferee,
    );
    expect(rounds.map((r) => r.roundName)).toEqual(['R1', 'R2']);
    expect(rounds[0]?.matches.map((m) => m.roundCode)).toEqual(['SF1', 'SF2']);
  });

  it('renders an empty side as a placeholder, never as "null"', () => {
    const rounds = bracketToPrint(
      slots,
      SINGLE_ELIM_4,
      LICES,
      (round) => `R${round}`,
      LABELS.unknownReferee,
    );
    expect(rounds[1]?.matches[0]?.blueName).toBe('—');
  });

  /** Same hop on the bracket side, where the field arrives already camelCase. */
  it('carries a slot’s planned start through, and null when it has none', () => {
    const rounds = bracketToPrint(
      [
        bracketSlot({ scheduledAt: '2026-06-06T16:00:00.000Z' }),
        bracketSlot({ position: 2, redFighterName: 'C', blueFighterName: 'D' }),
      ],
      SINGLE_ELIM_2,
      LICES,
      () => 'Final',
      LABELS.unknownReferee,
    );

    expect(rounds[0]?.matches[0]?.scheduledAt).toBe('2026-06-06T16:00:00.000Z');
    expect(rounds[0]?.matches[1]?.scheduledAt).toBeNull();
  });

  // The pack printed `R1-3` for every bracket bout: the bracket read sent no code, so the
  // positional fallback was the only path that ran. A bout prints the code the API built.
  it('prints the bout code the bracket read sends', () => {
    const rounds = bracketToPrint(
      [bracketSlot({ round: 1, position: 3, roundCode: 'LSW-B-QF-M3' })],
      { bracketSize: 8, wbRounds: null, lbRounds: null },
      LICES,
      () => 'Quarter-final',
      LABELS.unknownReferee,
    );
    expect(rounds[0]?.matches[0]?.roundCode).toBe('LSW-B-QF-M3');
  });

  // Ruling 891: the bracket read sends each bout's referees, and the pack printed none, so a
  // bracket scoresheet and its piste row always said "Not assigned".
  it('prints a bracket bout’s referees, and "Unknown referee" for a blank name', () => {
    const rounds = bracketToPrint(
      [bracketSlot({ referees: [{ displayName: 'Paul Contrequarte' }, { displayName: '  ' }] })],
      SINGLE_ELIM_2,
      LICES,
      () => 'Final',
      LABELS.unknownReferee,
    );
    expect(rounds[0]?.matches[0]?.referees).toEqual(['Paul Contrequarte', 'Arbitre inconnu']);
  });
});

describe('printPackHtml', () => {
  const pools = poolsToPrint([apiPool()], LICES, LABELS.unknownReferee);
  const bracketRounds = bracketToPrint(
    [bracketSlot({ roundCode: 'F' })],
    SINGLE_ELIM_2,
    LICES,
    () => 'Finale',
    LABELS.unknownReferee,
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
      pools: poolsToPrint([nasty], LICES, LABELS.unknownReferee),
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

describe('printJoinedPacksHtml (O22: "All Tournaments")', () => {
  const pack = (tournamentName: string, poolName: string) => ({
    meta: { ...META, tournamentName },
    labels: LABELS,
    pools: poolsToPrint([apiPool({ poolName })], LICES, LABELS.unknownReferee),
    bracketRounds: [],
    allMatches: [],
    sections: ['pools'] as const,
  });

  it("holds each Tournament's sheets, in order, in one document named after the Event", () => {
    const html = printJoinedPacksHtml('FAL 2026', [
      pack('Longsword Open', 'Pool A'),
      pack('Sabre Open', 'Pool S'),
    ]);
    expect(html.match(/<!doctype html>/gi)).toHaveLength(1);
    expect(html).toContain('<title>FAL 2026</title>');
    expect(html.match(/class="sheet"/g)).toHaveLength(2);
    expect(html.indexOf('Pool A')).toBeLessThan(html.indexOf('Pool S'));
    expect(html).toContain('Sabre Open');
    expect(html).toContain('.sheet:last-child { page-break-after: auto; }');
  });

  it('prints one pack exactly as that Tournament printed alone', () => {
    const alone = pack('Longsword Open', 'Pool A');
    expect(printPackSheets(alone)).toHaveLength(1);
    expect(printPackHtml(alone)).toContain(printPackSheets(alone)[0]);
  });
});
