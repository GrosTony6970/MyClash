import { test, expect } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, ensureRoster, POINT_CAP } from './_bracket';
import { linesOf, readStoredZip, splitCsvRow } from './_bundle';
import { buildSwissTournament, playSwiss, readSwiss } from './_swiss';

/**
 * The two places Swiss data leaves the app (run with E2E_SWISS=1).
 *
 * Both are round-trips OUT of MyClash, and both were changed by the Swiss build
 * without any end-to-end coverage following them:
 *
 *   1. **The archive.** `swiss_rounds` must restore BEFORE `matches`, because a
 *      match carries `swiss_round_id` and the FK remap needs the round it points
 *      at to exist. `archive.migration-coverage.test.ts` asserts the tables are
 *      LISTED and `INSERT_ORDER` is a constant it reads — neither replays a
 *      restore. Get the order wrong and every bout is orphaned, silently.
 *   2. **HEMA Ratings.** This is why slice 1 shipped first: before it,
 *      `hemaRatingsRound` fell through to `return 'Elimination'` for anything
 *      that was not a pool, so Swiss rounds would have been submitted to the
 *      PUBLIC HEMA Ratings database labelled "Elimination". Wrong data that
 *      escapes permanently is the one class of bug a later fix cannot undo.
 *
 * Built as its own spec rather than folded into `17-archive-restore` /
 * `12-exports`: both of those assert EXACT counts and round-label maps for the
 * bracket fixture they build, and a second tournament in the same event would
 * break those assertions rather than extend them. `17` is also already 519
 * lines.
 */
const SWISS = ['1', 'true', 'yes'].includes((process.env.E2E_SWISS ?? '').toLowerCase());

const RESTORE_CONFIRMATION = 'RESTORE MYCLASH ARCHIVE';
/** Odd, so a bye exists to survive the round-trip too. */
const FIELD = 9;
const ROUNDS = 3;
/** Carries a gender and a material word, so the HEMA pre-flight does not flag it. */
const TOURNAMENT_NAME = 'Swiss Mixed Steel Longsword';

interface Archive {
  manifest: string;
  data: Record<string, Array<Record<string, unknown>>>;
}

const upload = (text: string) => ({
  file: { name: 'archive.json', mimeType: 'application/json', buffer: Buffer.from(text) },
});

test.describe(SWISS ? 'Swiss data round-trips' : 'Swiss data round-trips (set E2E_SWISS=1)', () => {
  test.skip(!SWISS, 'Writes real tournaments and scores real matches; opt in with E2E_SWISS=1.');

  test('Swiss rounds survive an archive export and restore', async ({ request }) => {
    test.setTimeout(900_000);
    const api = apiFor(request);
    const { orgId } = runContext();
    const token = Date.now().toString(36);

    // Disposable with results recorded, and the copy inherits the kind.
    const event = await api.json<{ id: string }>(
      await api.post(`organizations/${orgId}/events`, {
        data: {
          name: `E2E TEST (auto) swiss-archive — ${token}`,
          slug: `e2e-swiss-archive-${token}`,
          startDate: '2099-06-01',
          endDate: '2099-06-02',
          city: 'Testville',
          country: 'FR',
          eventKind: 'test',
        },
      }),
    );

    const { tournament, seeds } = await buildSwissTournament(api, event.id, {
      key: `archive-${token}`,
      count: FIELD,
      roundCount: ROUNDS,
    });
    const played = await playSwiss(api, tournament.id, seeds);
    expect(played.stallReport, played.stallReport).toBe('');

    const source = await readSwiss(api, tournament.id);
    const sourcePairings = pairingKeys(source);
    const sourceByes = source.rounds.map((round) => round.byeFighterName);
    expect(sourceByes.filter(Boolean), 'an odd field owes a bye every round').toHaveLength(ROUNDS);

    // ── Export ─────────────────────────────────────────────────────────────
    const archiveText = await (
      await api.ok(await api.get(`events/${event.id}/archive?include=scoring&format=json`))
    ).text();

    const preview = await api.json<{ counts: Record<string, number>; canRestore: boolean }>(
      await api.post('archive/restore-preview', { multipart: upload(archiveText) }),
    );
    expect(preview.canRestore).toBe(true);
    // The two tables the archive guard can only prove are LISTED.
    //
    // Keyed by the ARCHIVE key, not the table name: `countArchiveRows` counts
    // `archive.data`'s own keys, and `TABLE_TO_ARCHIVE_KEY` maps `swiss_rounds`
    // to `swissRounds`. The single-word tables the other archive spec asserts
    // (`matches`, `persons`) are identical either way, which is what hides this.
    expect(preview.counts['swissRounds'], 'no swiss rounds in the archive').toBe(ROUNDS);
    expect(preview.counts['swissEntrants'], 'no swiss entrants in the archive').toBe(FIELD);

    // ── Restore ────────────────────────────────────────────────────────────
    const restored = await api.json<{ restoredEventId: string }>(
      await api.post(
        `archive/restore?${new URLSearchParams({
          confirmation: RESTORE_CONFIRMATION,
          targetOrganizationId: orgId,
        })}`,
        { multipart: upload(archiveText) },
      ),
    );
    expect(restored.restoredEventId).toBeTruthy();
    expect(restored.restoredEventId, 'a restore is a COPY, never a move').not.toBe(event.id);

    // ── The copy reproduces the phase ──────────────────────────────────────
    const copyTournaments = await api.json<Array<{ id: string }>>(
      await api.get(`events/${restored.restoredEventId}/tournaments`),
    );
    expect(copyTournaments).toHaveLength(1);
    const copy = await readSwiss(api, copyTournaments[0]!.id);

    expect(copy.rounds).toHaveLength(ROUNDS);
    // Names, not ids: the ids are all remapped by the restore, so comparing them
    // would only prove the remap ran. Comparing the PAIRINGS proves it ran
    // correctly — every bout still joins the same two people, which is only true
    // if swiss_rounds landed before matches and every FK was re-pointed.
    expect(pairingKeys(copy), 'the restored pairings differ from the source').toEqual(
      sourcePairings,
    );
    expect(copy.rounds.map((round) => round.byeFighterName)).toEqual(sourceByes);
  });

  test('the HEMA Ratings bundle labels Swiss rounds, never "Elimination"', async ({ request }) => {
    test.setTimeout(900_000);
    const api = apiFor(request);
    const { eventId } = runContext();
    const token = Date.now().toString(36);

    // Its own roster so the shared event's other tournaments cannot contribute
    // rows to the file this test reads.
    const fighters = await ensureRoster(
      api,
      eventId,
      Array.from({ length: FIELD }, (_, index) => ({
        givenName: 'Ratings',
        familyName: String(index + 1).padStart(2, '0'),
      })),
    );
    expect(fighters).toHaveLength(FIELD);

    const { tournament, seeds } = await buildSwissTournament(api, eventId, {
      key: `ratings-${token}`,
      count: FIELD,
      roundCount: ROUNDS,
    });
    await api.ok(
      await api.patch(`tournaments/${tournament.id}`, { data: { name: TOURNAMENT_NAME } }),
    );
    const played = await playSwiss(api, tournament.id, seeds);
    expect(played.stallReport, played.stallReport).toBe('');

    const zip = await api.ok(await api.get(`events/${eventId}/exports/hema-ratings.zip`));
    const bundle = readStoredZip(await zip.body());
    const matchesFile = bundle.get(`${TOURNAMENT_NAME}.csv`);
    expect(matchesFile, `the bundle has no ${TOURNAMENT_NAME}.csv`).toBeTruthy();

    // Column 5 is the round label (`hema-ratings-rows.ts`), the field HEMA
    // Ratings groups a tournament's matches by.
    const rounds = linesOf(matchesFile!).map((line) => splitCsvRow(line)[4]);
    expect(rounds.length).toBe(ROUNDS * Math.floor(FIELD / 2));
    // THE assertion this spec exists for.
    expect(rounds, 'a Swiss round was labelled as an elimination round').not.toContain(
      'Elimination',
    );
    expect(new Set(rounds)).toEqual(
      new Set(Array.from({ length: ROUNDS }, (_, i) => `Swiss Round ${i + 1}`)),
    );
  });

  test('exchange round codes carry the Swiss segment', async ({ request }) => {
    test.setTimeout(900_000);
    const api = apiFor(request);
    const { eventId } = runContext();
    const { tournament, seeds } = await buildSwissTournament(api, eventId, {
      key: `roundcode-${Date.now().toString(36)}`,
      count: FIELD,
      roundCount: ROUNDS,
    });
    const played = await playSwiss(api, tournament.id, seeds);
    expect(played.stallReport, played.stallReport).toBe('');

    const csv = await (
      await api.ok(await api.get(`tournaments/${tournament.id}/exports/matches.csv`))
    ).text();
    const codes = linesOf(csv)
      .map((line) => splitCsvRow(line)[1] ?? '')
      .filter((code) => code.length > 0 && !code.startsWith('round_code'));
    expect(codes.length).toBeGreaterThan(0);

    // `LSW-S3-M2`, not the segment-less `LSW-M1`. Without the middle segment a
    // Swiss code is ambiguous with a pool one — exactly the ambiguity the `B`
    // segment was added to kill, per `round-code.ts`'s own docstring.
    for (const code of codes) {
      expect(code, `round code "${code}" has no Swiss segment`).toMatch(/-S\d+-M\d+$/);
    }
  });
});

/** `Round 1: Ada Lovelace vs Alan Turing` for every bout, order-independent. */
function pairingKeys(swiss: Awaited<ReturnType<typeof readSwiss>>): string[] {
  return swiss.rounds
    .flatMap((round) =>
      round.matches.map((match) =>
        [
          `R${round.roundNumber}`,
          [match.redFighterName ?? '', match.blueFighterName ?? ''].sort().join(' vs '),
        ].join(': '),
      ),
    )
    .sort();
}
