import { test, expect } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_api';
import { ensureClub, ensureRoster, personName, POINT_CAP, type Person } from './_bracket';
import { playTournamentToChampion, type FinishedTournament } from './_tournament';
import { linesOf, neutralisedForSpreadsheet, readStoredZip, splitCsvRow } from './_bundle';

/**
 * The export surfaces, end to end (run with E2E_EXPORTS=1).
 *
 * Exports fail SILENTLY. A CSV with the wrong winner, a dropped match or the
 * wrong escaper still parses, still opens, still looks right — and the mistake
 * only surfaces months later in someone else's database. That is exactly the
 * failure mode a unit test over hand-built rows keeps missing, because the rows
 * it checks are the rows it wrote.
 *
 * So every assertion here reconciles the export against something the spec knows
 * INDEPENDENTLY: the bracket the API returned, the exchanges the pad posted, and
 * arithmetic that has to balance (every match contributes exactly one win, and
 * the points one fighter scored are the points another conceded).
 *
 * The two escapers are the sharpest edge. MyClash has two on purpose:
 *
 *   - `escapeCsvCell` — RFC 4180 + FORMULA NEUTRALISATION, for files a person
 *     opens in a spreadsheet. `=Export 08` becomes `"'=Export 08"`.
 *   - `escapeCsvField` — RFC 4180 only, for the HEMA Ratings bundle, which no
 *     person reads: their importer parses it, and an injected apostrophe would
 *     corrupt the name they store.
 *
 * One fighter in this roster is named `=Export 08` for that reason alone. The
 * same person must appear neutralised in the tournament ranking report and RAW
 * in the HEMA bundle — one roster, one run, both escapers proved.
 */
const EXPORTS = ['1', 'true', 'yes'].includes((process.env.E2E_EXPORTS ?? '').toLowerCase());

const ROSTER_SIZE = 8;

/**
 * A fighter whose name starts like a spreadsheet formula. Everything about the
 * escaper assertions hangs off this one row; it is deliberately the LAST seed so
 * it cannot influence who wins anything.
 */
const FORMULA_GIVEN_NAME = '=Export';
const FORMULA_FIGHTER_NAME = `${FORMULA_GIVEN_NAME} 0${ROSTER_SIZE}`;

/** Some fighters are affiliated so the bundle has a clubs.csv to check. */
const EXPORT_CLUB = 'E2E Export Fencing Club';
const CLUBBED_SEEDS = 4;

/**
 * HEMA Ratings reads the tournament name out of the FILENAME, and their
 * submission rules want gender and material words in it ("Mixed", "Steel") —
 * so this name is chosen to satisfy the pre-flight rather than trip it, and the
 * spec asserts the pre-flight agrees.
 */
const TOURNAMENT_NAME = 'Mixed Steel Longsword — E2E exports';

/** Matches played by `playTournamentToChampion`: 8-fighter bronze double elim. */
const MATCHES = 12;

/**
 * Exchanges `scoreMatch` posts per match: the loser takes `cap - 2` as 2+1 and
 * the winner takes `cap` as 2+2+1. Every match therefore ends exactly 5–3.
 */
const EXCHANGES_PER_MATCH = 5;
const LOSER_SCORE = POINT_CAP - 2;

/**
 * Round labels the bundle must carry for this bracket, and how many of each.
 * Derived from the shape, not observed: 8 fighters in bronze mode means
 * `wbRounds = 3` and `lbRounds = 3`, and `hemaRatingsRound` names the
 * winners-bracket final "Final" (bronze mode has no grand final) and the last
 * losers round "Bronze Final". Hardcoded so a drift shows up as a diff.
 */
const EXPECTED_ROUNDS: Readonly<Record<string, number>> = {
  'Winners Quarter Final': 4,
  'Winners Semi Final': 2,
  Final: 1,
  'Losers Round 1': 2,
  'Losers Round 2': 2,
  'Bronze Final': 1,
};

const MATCHES_CSV_HEADER =
  'match_id,round_code,match_label,status,red_registration_id,blue_registration_id,red_score,blue_score,winner_registration_id';
const EXCHANGES_CSV_HEADER =
  'exchange_id,match_id,sequence,type,first_striker,first_strike_value,afterblow_value,voided';
const RANKINGS_CSV_HEADER = 'rank,name,wins,points_for,points_against';

/** First column of each HEMA header row — none of which may appear in a file. */
const HEMA_HEADER_MARKERS = ['Name («Firstname', 'Fighter 1 (Written', 'Club Name (Full name'];

// ── Shared state ─────────────────────────────────────────────────────────────

interface Fixture {
  eventId: string;
  fighters: Person[];
  tournament: FinishedTournament;
}
let fixture: Fixture;

// ── Helpers ─────────────────────────────────────────────────────────────────

const csvText = async (api: Api, path: string): Promise<string> =>
  (await (await api.ok(await api.get(path))).text()).trimEnd();

// ── Spec ─────────────────────────────────────────────────────────────────────

test.describe('exports', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!EXPORTS, 'set E2E_EXPORTS=1 to generate and parse every export for real');

  test('tournament CSV reports reconstruct the bracket that produced them', async ({ request }) => {
    test.setTimeout(900_000);
    const api = apiFor(request);
    const { eventId } = runContext();

    const clubId = await ensureClub(api, EXPORT_CLUB);
    const fighters = await ensureRoster(
      api,
      eventId,
      Array.from({ length: ROSTER_SIZE }, (_, index) => ({
        // The last seed carries the formula-leading name. It is last so the two
        // escaper assertions cost nothing else: seeding decides every result, so
        // a strange name cannot change who wins.
        givenName: index === ROSTER_SIZE - 1 ? FORMULA_GIVEN_NAME : 'Export',
        familyName: String(index + 1).padStart(2, '0'),
        clubId: index < CLUBBED_SEEDS ? clubId : null,
      })),
    );
    expect(personName(fighters[ROSTER_SIZE - 1]!)).toBe(FORMULA_FIGHTER_NAME);

    const tournament = await playTournamentToChampion(api, eventId, {
      name: TOURNAMENT_NAME,
      slug: `e2e-exports-${Date.now().toString(36)}`,
      fighters,
    });
    fixture = { eventId, fighters, tournament };

    // ── matches.csv ──────────────────────────────────────────────────────────
    const matchesCsv = await csvText(api, `tournaments/${tournament.id}/exports/matches.csv`);
    const matchLines = linesOf(matchesCsv);
    expect(matchLines[0]).toBe(MATCHES_CSV_HEADER);
    expect(matchLines).toHaveLength(MATCHES + 1);

    const matchRows = matchLines.slice(1).map((line) => {
      const [id, roundCode, , status, , , redScore, blueScore, winner] = splitCsvRow(line);
      return {
        id: id!,
        roundCode: roundCode!,
        status: status!,
        redScore: Number(redScore),
        blueScore: Number(blueScore),
        winner: winner!,
      };
    });

    // Every played slot is in the file, exactly once — nothing dropped, nothing
    // duplicated.
    expect(new Set(matchRows.map((row) => row.id))).toEqual(
      new Set(tournament.bracket.slots.map((slot) => slot.matchId)),
    );

    // The winner the export names is the winner the BRACKET recorded. This is
    // the assertion a wrong join or a stale column would break, and the one a
    // fixture-driven unit test can never make.
    const winnerBySlotMatchId = new Map(
      tournament.bracket.slots.map((slot) => [slot.matchId, slot.winnerRegistrationId]),
    );
    for (const row of matchRows) {
      expect(row.status).toBe('completed');
      expect(row.winner, `winner mismatch for match ${row.id}`).toBe(
        winnerBySlotMatchId.get(row.id),
      );
      // Every match was played to the cap by `scoreMatch`, and the loser stopped
      // two short, so the scoreline is knowable without reading it back.
      expect([row.redScore, row.blueScore].sort((a, b) => a - b)).toEqual([LOSER_SCORE, POINT_CAP]);
      expect(row.roundCode.length).toBeGreaterThan(0);
    }

    // ── exchanges.csv ────────────────────────────────────────────────────────
    const exchangesCsv = await csvText(api, `tournaments/${tournament.id}/exports/exchanges.csv`);
    const exchangeLines = linesOf(exchangesCsv);
    expect(exchangeLines[0]).toBe(EXCHANGES_CSV_HEADER);
    expect(exchangeLines).toHaveLength(MATCHES * EXCHANGES_PER_MATCH + 1);

    const scoredBy = new Map<string, { red: number; blue: number; sequences: number[] }>();
    for (const line of exchangeLines.slice(1)) {
      const [, matchId, sequence, type, striker, value, afterblow, voided] = splitCsvRow(line);
      expect(type).toBe('clean');
      expect(voided).toBe('false');
      expect(afterblow).toBe('');
      const totals = scoredBy.get(matchId!) ?? { red: 0, blue: 0, sequences: [] };
      totals[striker as 'red' | 'blue'] += Number(value);
      totals.sequences.push(Number(sequence));
      scoredBy.set(matchId!, totals);
    }

    // The exported exchanges must ADD UP to the exported scores. Silent
    // wrongness in this area looks exactly like a file that parses fine and
    // disagrees with itself by one hit.
    expect(scoredBy.size).toBe(MATCHES);
    for (const row of matchRows) {
      const totals = scoredBy.get(row.id);
      expect(totals, `no exchanges exported for match ${row.id}`).toBeDefined();
      expect(totals!.red).toBe(row.redScore);
      expect(totals!.blue).toBe(row.blueScore);
      expect([...totals!.sequences].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    }

    // ── rankings.csv ─────────────────────────────────────────────────────────
    const rankingsCsv = await csvText(api, `tournaments/${tournament.id}/exports/rankings.csv`);
    const rankingLines = linesOf(rankingsCsv);
    expect(rankingLines[0]).toBe(RANKINGS_CSV_HEADER);
    expect(rankingLines).toHaveLength(ROSTER_SIZE + 1);

    const rankingRows = rankingLines.slice(1).map((line) => {
      const [rank, name, wins, pointsFor, pointsAgainst] = splitCsvRow(line);
      return {
        rank: Number(rank),
        name: name!,
        wins: Number(wins),
        pointsFor: Number(pointsFor),
        pointsAgainst: Number(pointsAgainst),
      };
    });

    expect(rankingRows.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Every fighter, once. RFC-unquoting gives back the neutralised value, not
    // the original: the leading apostrophe is the payload `escapeCsvCell` adds,
    // and a spreadsheet — not the CSV parser — is what strips it on display.
    expect(new Set(rankingRows.map((row) => row.name))).toEqual(
      new Set(fighters.map((f) => neutralisedForSpreadsheet(personName(f)))),
    );
    // This report ranks by wins, so it must be ordered by them.
    for (let i = 1; i < rankingRows.length; i++) {
      expect(rankingRows[i]!.wins).toBeLessThanOrEqual(rankingRows[i - 1]!.wins);
    }
    // Conservation: one win per match, and every point one fighter scored is a
    // point another conceded. A double-counted or dropped match breaks both.
    const total = (key: 'wins' | 'pointsFor' | 'pointsAgainst') =>
      rankingRows.reduce((sum, row) => sum + row[key], 0);
    expect(total('wins')).toBe(MATCHES);
    expect(total('pointsFor')).toBe(MATCHES * (POINT_CAP + LOSER_SCORE));
    expect(total('pointsAgainst')).toBe(total('pointsFor'));

    // The human-facing report NEUTRALISES the formula name: quoted, with the
    // leading apostrophe a spreadsheet strips on display.
    expect(rankingsCsv).toContain(`"'${FORMULA_FIGHTER_NAME}"`);
  });

  test('the HEMA Ratings bundle matches their contract, not ours', async ({ request }) => {
    test.setTimeout(900_000);
    const api = apiFor(request);
    const { eventId, tournament, fighters } = fixture;
    const tournamentFile = `${TOURNAMENT_NAME}.csv`;

    const preview = await api.json<{
      files: string[];
      counts: { clubs: number; fighters: number; tournaments: number; matches: number };
      warnings: Array<{ code: string; count: number; samples: string[] }>;
    }>(await api.get(`events/${eventId}/exports/hema-ratings/preview`));

    // The tournament NAME is the filename — spaces, case and the em dash all
    // survive, because HEMA Ratings reads the tournament out of it.
    expect(preview.files).toContain(tournamentFile);
    expect(preview.files).toContain('fighters.csv');
    expect(preview.files).toContain('clubs.csv');
    // Other specs share this event, so event-wide counts are lower bounds.
    expect(preview.counts.matches).toBeGreaterThanOrEqual(MATCHES);

    // Our name carries a gender word and a material word, so the pre-flight must
    // not flag it. (Other tournaments in the shared event may well be flagged.)
    for (const code of ['tournament_name_missing_gender', 'tournament_name_missing_material']) {
      const warning = preview.warnings.find((w) => w.code === code);
      expect(warning?.samples ?? [], `${code} flagged our tournament`).not.toContain(
        TOURNAMENT_NAME,
      );
    }

    const zipResponse = await api.ok(await api.get(`events/${eventId}/exports/hema-ratings.zip`));
    expect(zipResponse.headers()['content-type']).toContain('application/zip');
    const bundle = readStoredZip(await zipResponse.body());

    // The pre-flight is a promise about the download; it must not lie about it.
    expect([...bundle.keys()]).toEqual(preview.files);

    const matchesFile = bundle.get(tournamentFile)!;
    const fightersFile = bundle.get('fighters.csv')!;
    const clubsFile = bundle.get('clubs.csv')!;

    // ── No header row ────────────────────────────────────────────────────────
    // HEMA Ratings' own reference exporter (HEMA Scorecard) drops straight into
    // the row loop, and we match it: data starts on line 1 in every file.
    for (const [name, body] of bundle) {
      for (const marker of HEMA_HEADER_MARKERS) {
        expect(body, `${name} carries a header row`).not.toContain(marker);
      }
    }

    // ── The tournament file ──────────────────────────────────────────────────
    const matchRows = linesOf(matchesFile).map(splitCsvRow);
    expect(matchRows).toHaveLength(MATCHES);
    for (const row of matchRows) expect(row).toHaveLength(5);

    // Every match here was decided normally: one Win, one Loss, no draws and no
    // double losses (which their spec says must be a loss for BOTH fighters).
    const results = matchRows.flatMap((row) => [row[2]!, row[3]!]);
    expect(results.filter((r) => r === 'Win')).toHaveLength(MATCHES);
    expect(results.filter((r) => r === 'Loss')).toHaveLength(MATCHES);

    // Guard the premise before the labels: EXPECTED_ROUNDS is derived from this
    // shape, so a changed bracket should fail here rather than as a confusing
    // round-name diff.
    expect([tournament.bracket.wbRounds, tournament.bracket.lbRounds]).toEqual([3, 3]);
    const roundCounts: Record<string, number> = {};
    for (const row of matchRows) roundCounts[row[4]!] = (roundCounts[row[4]!] ?? 0) + 1;
    expect(roundCounts).toEqual(EXPECTED_ROUNDS);

    // ── fighters.csv, and the escaper that must NOT neutralise ───────────────
    const fighterRows = linesOf(fightersFile).map(splitCsvRow);
    for (const row of fighterRows) expect(row).toHaveLength(5);

    const rowByName = new Map(fighterRows.map((row) => [row[0]!, row]));
    for (const fighter of fighters) {
      expect(rowByName.has(personName(fighter)), `${personName(fighter)} missing`).toBe(true);
    }

    // RAW, not neutralised: this bundle is machine-read, and an injected
    // apostrophe would corrupt the name HEMA Ratings stores. The same person is
    // quoted-and-prefixed in the ranking report checked above.
    expect(
      linesOf(fightersFile).some((line) => line.startsWith(`${FORMULA_FIGHTER_NAME},`)),
      'the formula-leading name was not written raw',
    ).toBe(true);
    expect(fightersFile).not.toContain(`"'${FORMULA_FIGHTER_NAME}"`);

    // ── Names must be byte-identical across files ────────────────────────────
    // HEMA Ratings joins on the name STRING, so a fighter spelled differently in
    // the two files becomes two people upstream.
    const namesInMatches = new Set(matchRows.flatMap((row) => [row[0]!, row[1]!]));
    for (const name of namesInMatches) {
      expect(rowByName.has(name), `${name} appears in a match but not in fighters.csv`).toBe(true);
    }
    expect(namesInMatches.has(FORMULA_FIGHTER_NAME)).toBe(true);

    // Club names likewise, between clubs.csv and the fighters' Club column.
    const clubNames = new Set(linesOf(clubsFile).map((line) => splitCsvRow(line)[0]!));
    expect(clubNames.has(EXPORT_CLUB)).toBe(true);
    const clubbed = fighters.slice(0, CLUBBED_SEEDS).map((f) => rowByName.get(personName(f))!);
    for (const row of clubbed) expect(row[1]).toBe(EXPORT_CLUB);

    // ── Only standard events may be submitted ────────────────────────────────
    // Test and club events are dry runs and internal activity; letting either
    // reach a global rating pool corrupts real fighters' ratings. Restored in
    // `finally` so the shared event is handed on exactly as it was found.
    try {
      await api.ok(await api.patch(`events/${eventId}`, { data: { eventKind: 'test' } }));
      expect((await api.get(`events/${eventId}/exports/hema-ratings.zip`)).status()).toBe(400);
      expect((await api.get(`events/${eventId}/exports/hema-ratings/preview`)).status()).toBe(400);
    } finally {
      await api.ok(await api.patch(`events/${eventId}`, { data: { eventKind: 'standard' } }));
    }
    expect((await api.get(`events/${eventId}/exports/hema-ratings/preview`)).status()).toBe(200);
  });
});
