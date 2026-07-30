import { test, expect } from '@playwright/test';
import { runContext } from './_context';
import { apiFor } from './_api';
import { championOf, ensureRoster, personName, readBracket, type Bracket } from './_bracket';
import { playTournamentToChampion, type FinishedTournament } from './_tournament';

/**
 * Export an archive, restore it, and prove the copy reproduces the original
 * (run with `E2E_ARCHIVE=1`; see README for the full rationale).
 *
 * `archive.service.ts` is ~1300 lines and had no end-to-end coverage at all.
 * `archive.migration-coverage.test.ts` proves tables are LISTED, never that a
 * restore reproduces anything, and `archive.service.test.ts` mocks Supabase — a
 * mock inserts any column without caring what it references, which is exactly
 * how `matches.referee_id` went unmapped for as long as it did.
 *
 * Restore always creates a NEW copy, so this is safe to drive for real. Both
 * restore paths are covered because they are different code with different
 * rules: an EVENT restore forces the copy to draft and copies the person rows,
 * while a TOURNAMENT restore forces the tournament to draft and shares the
 * persons when the target is the event the archive came from.
 *
 * It builds its own `event_kind: 'test'` event. An event-scope archive of the
 * shared throwaway event would drag in every other spec's tournaments and vary
 * run to run; `test` is also the one kind that stays hard-deletable with results
 * recorded, and `restoreEventCopy` spreads the source row, so the copy inherits
 * it and cleans up too.
 */
const ARCHIVE = ['1', 'true', 'yes'].includes((process.env.E2E_ARCHIVE ?? '').toLowerCase());

const RESTORE_CONFIRMATION = 'RESTORE MYCLASH ARCHIVE';
const ROSTER_SIZE = 8;

type Row = Record<string, unknown>;

/** The `myclash.archive.v1` envelope, as far as this spec reads it. */
interface Archive {
  manifest: string;
  version: number;
  scope: string;
  include: string;
  source: { eventId: string; eventSlug: string };
  data: {
    events?: Row[];
    tournaments?: Row[];
    persons?: Row[];
    registrations?: Row[];
    matches?: Row[];
  };
  reports: {
    tournaments: Array<{ tournamentName: string; exchangesCsv: string; resultsCsv: string }>;
  };
}

interface RestorePreview {
  manifest: string;
  scope: string;
  include: string;
  counts: Record<string, number>;
  warnings: string[];
  canRestore: boolean;
}

interface RestoreResult {
  scope: string;
  restoredEventId?: string;
  restoredTournamentId?: string;
  restoredSlug: string;
}

interface EventRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  event_kind?: string;
}

interface PersonRow {
  id: string;
  givenName: string;
  familyName: string;
  claimStatus?: string;
  claim_status?: string;
}

interface RegistrationRow {
  id: string;
  person_id: string;
  persons?: { given_name: string; family_name: string } | null;
}

interface Fixture {
  eventId: string;
  eventSlug: string;
  orgId: string;
  tournament: FinishedTournament;
  bracket: Bracket;
  /** The archive JSON exported from the source event, verbatim. */
  eventArchiveText: string;
  /** The match a referee was pinned to, by its bracket coordinates. */
  refereeSlot: { round: number; position: number };
  refereeName: string;
}
let fixture: Fixture;
let restoredEventId: string | null = null;

test.describe('archive restore', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!ARCHIVE, 'set E2E_ARCHIVE=1 to export an archive and restore it for real');

  test('an event archive restores as a copy that reproduces what was played', async ({
    request,
  }) => {
    test.setTimeout(900_000);
    const api = apiFor(request);
    const { orgId } = runContext();
    const token = Date.now().toString(36);

    // ── A disposable, self-contained source event ──────────────────────────
    const eventSlug = `e2e-archive-${token}`;
    const event = await api.json<EventRow>(
      await api.post(`organizations/${orgId}/events`, {
        data: {
          name: `E2E TEST (auto) archive — ${token}`,
          slug: eventSlug,
          startDate: '2099-05-01',
          endDate: '2099-05-02',
          city: 'Testville',
          country: 'FR',
          // Disposable with results recorded, and the copy inherits the kind.
          eventKind: 'test',
        },
      }),
    );

    const fighters = await ensureRoster(
      api,
      event.id,
      Array.from({ length: ROSTER_SIZE }, (_, i) => ({
        givenName: 'Archie',
        familyName: String(i + 1).padStart(2, '0'),
      })),
    );
    const tournament = await playTournamentToChampion(api, event.id, {
      name: `Archive Cup ${token}`,
      slug: `archive-cup-${token}`,
      fighters,
    });
    const bracket = await readBracket(api, tournament.id);

    // Pin a referee on one played match. `matches.referee_id` is an
    // event-scoped `persons.id`, so a restore has to re-point it at the COPY's
    // person — it did not, and this is the assertion that would have caught it.
    const refereeSlot = bracket.slots.find((s) => s.matchId)!;
    const referee = fighters[0]!;
    await api.ok(
      await api.patch(`matches/${refereeSlot.matchId}`, { data: { refereeId: referee.id } }),
    );

    // ── Export ────────────────────────────────────────────────────────────
    const eventArchiveText = await (
      await api.ok(await api.get(`events/${event.id}/archive?include=scoring&format=json`))
    ).text();
    const archive = JSON.parse(eventArchiveText) as Archive;
    expect(archive.manifest).toBe('myclash.archive.v1');
    expect({ scope: archive.scope, include: archive.include }).toEqual({
      scope: 'event',
      include: 'scoring',
    });
    expect(archive.source.eventId).toBe(event.id);

    fixture = {
      eventId: event.id,
      eventSlug,
      orgId,
      tournament,
      bracket,
      eventArchiveText,
      refereeSlot: { round: refereeSlot.round, position: refereeSlot.position },
      refereeName: personName(referee),
    };

    // ── Pre-flight: the manifest held to the data, not to itself ───────────
    const playedSlots = bracket.slots.filter((s) => s.matchId);
    const preview = await api.json<RestorePreview>(
      await api.post('archive/restore-preview', { multipart: upload(eventArchiveText) }),
    );
    expect({
      scope: preview.scope,
      include: preview.include,
      canRestore: preview.canRestore,
    }).toEqual({ scope: 'event', include: 'scoring', canRestore: true });
    expect(preview.warnings).toEqual([]);
    expect(
      {
        registrations: preview.counts['registrations'],
        matches: preview.counts['matches'],
        persons: preview.counts['persons'],
      },
      'the counts must describe what this run actually created',
    ).toEqual({
      registrations: ROSTER_SIZE,
      matches: playedSlots.length,
      persons: ROSTER_SIZE,
    });
    expect(preview.counts['exchanges'], 'the played exchanges must be in there').toBeGreaterThan(0);

    // ── The confirmation guard is the only thing between an organiser and an
    //    accidental clone, so it has to actually hold ────────────────────────
    const unconfirmed = await api.post(
      `archive/restore?${new URLSearchParams({ confirmation: 'yes please', targetOrganizationId: orgId })}`,
      { multipart: upload(eventArchiveText) },
    );
    expect(unconfirmed.status(), 'a wrong confirmation phrase must be refused').toBe(400);

    // ── Restore ────────────────────────────────────────────────────────────
    const result = await api.json<RestoreResult>(
      await api.post(
        `archive/restore?${new URLSearchParams({
          confirmation: RESTORE_CONFIRMATION,
          targetOrganizationId: orgId,
        })}`,
        { multipart: upload(eventArchiveText) },
      ),
    );
    expect(result.scope).toBe('event');
    expect(result.restoredEventId).toBeTruthy();
    restoredEventId = result.restoredEventId as string;
    expect(restoredEventId, 'a restore is a COPY, never a move').not.toBe(event.id);

    // ── The copy: its own event row ────────────────────────────────────────
    // Read from the copy's OWN archive export rather than `GET events/:slug` —
    // that route resolves by slug and is public, so it is the wrong door for an
    // id-addressed draft. The export is the org-admin one and returns the raw row.
    const copyArchive = JSON.parse(
      await (
        await api.ok(await api.get(`events/${restoredEventId}/archive?include=scoring&format=json`))
      ).text(),
    ) as Archive;
    const copy = copyArchive.data.events?.[0] as unknown as EventRow;
    expect(copy.name).toBe(`E2E TEST (auto) archive — ${token} (restored)`);
    expect(copy.status, 'a restored event lands as a draft, never live').toBe('draft');
    expect(copy.slug).not.toBe(eventSlug);
    expect(copy.slug).toContain('-restored-');
    expect(copy.event_kind, 'the kind carries, which is what keeps the copy disposable').toBe(
      'test',
    );

    // ── Persons COPIED, not shared ─────────────────────────────────────────
    const sourcePersons = await api.json<PersonRow[]>(await api.get(`events/${event.id}/persons`));
    const copyPersons = await api.json<PersonRow[]>(
      await api.get(`events/${restoredEventId}/persons`),
    );
    const names = (people: PersonRow[]) => people.map(personLabel).sort();
    expect(names(copyPersons), 'the roster comes across by name').toEqual(names(sourcePersons));
    const sourceIds = new Set(sourcePersons.map((p) => p.id));
    expect(
      copyPersons.filter((p) => sourceIds.has(p.id)),
      'every person is a NEW row — sharing them would tie the copy to its source',
    ).toEqual([]);
    for (const person of copyPersons) {
      expect(person.claimStatus ?? person.claim_status, 'a copied person is unclaimed').toBe(
        'unclaimed',
      );
    }

    // ── The tournament, its registrations and its bracket ──────────────────
    const copyTournaments = await api.json<Array<{ id: string; name: string }>>(
      await api.get(`events/${restoredEventId}/tournaments`),
    );
    expect(copyTournaments).toHaveLength(1);
    const copyTournamentId = copyTournaments[0]!.id;

    const copyRegistrations = await api.json<RegistrationRow[]>(
      await api.get(`tournaments/${copyTournamentId}/registrations`),
    );
    expect(copyRegistrations).toHaveLength(ROSTER_SIZE);
    expect(registrationNames(copyRegistrations)).toEqual(
      fighters.map(personName).sort((a, b) => a.localeCompare(b)),
    );

    const copyBracket = await readBracket(api, copyTournamentId);
    expect(copyBracket.totalSlots).toBe(bracket.totalSlots);
    expect(slotShape(copyBracket), 'every slot, its status and its score').toEqual(
      slotShape(bracket),
    );

    // The champion is the end of the whole chain — exchanges → completed
    // matches → bracket rows → the title slot. The copy must crown the same
    // fighter, which is only checkable by NAME (every id was regenerated).
    const copyChampion = championOf(copyBracket);
    expect(copyChampion, 'the copy has no champion').not.toBeNull();
    const copyNameByRegistration = new Map(
      copyRegistrations.map((r) => [r.id, registrationLabel(r)]),
    );
    const sourceChampion = fixture.tournament.personByRegistrationId.get(
      fixture.tournament.championRegistrationId,
    );
    expect(copyNameByRegistration.get(copyChampion as string)).toBe(personName(sourceChampion!));

    // ── The referee reference was re-pointed at the COPY's person ──────────
    const copyRefereeSlot = copyBracket.slots.find(
      (s) => s.round === refereeSlot.round && s.position === refereeSlot.position,
    );
    const copyMatch = await api.json<{ referee_id: string | null }>(
      await api.get(`matches/${copyRefereeSlot!.matchId}`),
    );
    const copyReferee = copyPersons.find((p) => personLabel(p) === fixture.refereeName);
    expect(
      copyMatch.referee_id,
      "the copy's match must name the copy's person, not the source event's",
    ).toBe(copyReferee!.id);

    // ── Every match and every exchange, in one comparison ──────────────────
    // The archive's own reports are the cheapest complete artefact: `resultsCsv`
    // is entirely name-based (round code, both fighters, both scores, winner) so
    // it is directly comparable across two copies with no ids in common.
    const sourceReport = archive.reports.tournaments[0]!;
    const copyReport = copyArchive.reports.tournaments[0]!;
    expect(
      sortedRows(copyReport.resultsCsv),
      'every match result must come across identically',
    ).toEqual(sortedRows(sourceReport.resultsCsv));
    // Exchanges carry ids in the first two columns; the rest — sequence, type,
    // striker, values, voided — must match as a multiset. Row ORDER is not
    // comparable: `listRowsByIds` has no ORDER BY.
    expect(exchangeFingerprint(copyReport.exchangesCsv)).toEqual(
      exchangeFingerprint(sourceReport.exchangesCsv),
    );

    // ── And the source is untouched ────────────────────────────────────────
    // A restore that quietly re-parented or renamed anything would show up here.
    // Compared against the row the PRE-restore archive captured, so this holds
    // whatever the source's slug and status happened to be.
    const before = archive.data.tournaments?.[0] as unknown as { slug: string; status: string };
    const after = await api.json<{ slug: string; status: string }>(
      await api.get(`tournaments/${tournament.id}`),
    );
    expect({ slug: after.slug, status: after.status }).toEqual({
      slug: before.slug,
      status: before.status,
    });
    expect(slotShape(await readBracket(api, tournament.id))).toEqual(slotShape(bracket));
  });

  /**
   * The other restore path, and the one an organiser reaches far more often:
   * recover a single tournament rather than a whole event.
   *
   * Its distinguishing rule is the person handling — restoring into the event
   * the archive came from SHARES the existing person rows (nothing is
   * duplicated), while restoring elsewhere copies them. Both branches here,
   * because getting it backwards either orphans the registrations or doubles the
   * roster.
   */
  test('a tournament archive restores into an event, sharing or copying its persons', async ({
    request,
  }) => {
    test.setTimeout(600_000);
    const api = apiFor(request);
    const { eventId: sharedEventId } = runContext();
    const archiveText = await (
      await api.ok(
        await api.get(`tournaments/${fixture.tournament.id}/archive?include=scoring&format=json`),
      )
    ).text();
    const archive = JSON.parse(archiveText) as Archive;
    expect(archive.scope).toBe('tournament');

    const restoreInto = async (targetEventId: string): Promise<RestoreResult> =>
      api.json<RestoreResult>(
        await api.post(
          `archive/restore?${new URLSearchParams({
            confirmation: RESTORE_CONFIRMATION,
            targetEventId,
          })}`,
          { multipart: upload(archiveText) },
        ),
      );

    // ── Into its own event: persons are SHARED ─────────────────────────────
    const personsBefore = await api.json<PersonRow[]>(
      await api.get(`events/${fixture.eventId}/persons`),
    );
    const sameEvent = await restoreInto(fixture.eventId);
    expect(sameEvent.scope).toBe('tournament');
    expect(sameEvent.restoredTournamentId).not.toBe(fixture.tournament.id);
    expect(sameEvent.restoredSlug).toContain('-restored-');

    const personsAfter = await api.json<PersonRow[]>(
      await api.get(`events/${fixture.eventId}/persons`),
    );
    expect(
      personsAfter.length,
      'restoring into the SAME event must reuse its people, not clone the roster',
    ).toBe(personsBefore.length);

    const sameEventRegistrations = await api.json<RegistrationRow[]>(
      await api.get(`tournaments/${sameEvent.restoredTournamentId}/registrations`),
    );
    const existingPersonIds = new Set(personsBefore.map((p) => p.id));
    expect(
      sameEventRegistrations.filter((r) => !existingPersonIds.has(r.person_id)),
      'every registration points at a person that already existed',
    ).toEqual([]);

    // The tournament itself is forced back to draft, whatever the source was.
    const restoredTournament = await api.json<{ status: string }>(
      await api.get(`tournaments/${sameEvent.restoredTournamentId}`),
    );
    expect(restoredTournament.status).toBe('draft');

    // …and it still reproduces the play: same slots, same scores, same champion.
    const restoredBracket = await readBracket(api, sameEvent.restoredTournamentId as string);
    expect(slotShape(restoredBracket)).toEqual(slotShape(fixture.bracket));
    const namesByRegistration = new Map(
      sameEventRegistrations.map((r) => [r.id, registrationLabel(r)]),
    );
    const champion = fixture.tournament.personByRegistrationId.get(
      fixture.tournament.championRegistrationId,
    );
    expect(namesByRegistration.get(championOf(restoredBracket) as string)).toBe(
      personName(champion!),
    );

    // ── Into a DIFFERENT event: persons are copied ─────────────────────────
    // The clone-last-year's-tournament flow. The target is the shared throwaway
    // event, so `global-teardown` disposes of it.
    const otherEvent = await restoreInto(sharedEventId);
    const copiedRegistrations = await api.json<RegistrationRow[]>(
      await api.get(`tournaments/${otherEvent.restoredTournamentId}/registrations`),
    );
    expect(copiedRegistrations).toHaveLength(ROSTER_SIZE);
    expect(
      copiedRegistrations.filter((r) => existingPersonIds.has(r.person_id)),
      'a cross-event restore must NOT reach back into the source event’s people',
    ).toEqual([]);
    expect(registrationNames(copiedRegistrations), 'the roster still comes across by name').toEqual(
      registrationNames(sameEventRegistrations),
    );
  });

  /**
   * Both events are `event_kind: 'test'`, so a single hard delete disposes of
   * each result graph. `E2E_CLEANUP` deletes them; otherwise they are left for
   * inspection with their URLs printed — the restored copy is the thing worth
   * eyeballing. Warn, never throw, so a failed assertion still tears down.
   */
  test.afterAll(async ({ playwright }) => {
    // Hooks take the CONFIG timeout (60 s), not the one the test set for itself,
    // and hard-deleting an event walks its whole result graph — two events with
    // twelve scored matches each is well over a minute on a slow day.
    test.setTimeout(300_000);
    const { baseURL, orgSlug } = runContext();
    const cleanup = ['1', 'true', 'yes'].includes((process.env.E2E_CLEANUP ?? '').toLowerCase());
    const targets = [fixture?.eventId, restoredEventId].filter((id): id is string => Boolean(id));
    if (targets.length === 0) return;

    const ctx = await playwright.request.newContext({
      baseURL,
      ignoreHTTPSErrors: true,
      storageState: 'tests/e2e/.auth/admin.json',
    });
    for (const id of targets) {
      if (!cleanup) {
        console.log(`[e2e] archive event PRESERVED: ${baseURL}/org/${orgSlug}/events/${id}`);
        continue;
      }
      const res = await ctx.delete(`/api/v1/events/${id}?mode=hard`);
      if (!res.ok()) {
        console.warn(`[e2e] could not delete archive event ${id}: ${res.status()}`);
      }
    }
    await ctx.dispose();
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** The multipart body both restore endpoints expect — field name `file`. */
const upload = (json: string) => ({
  file: { name: 'event.archive.json', mimeType: 'application/json', buffer: Buffer.from(json) },
});

const personLabel = (p: PersonRow) => `${p.givenName} ${p.familyName}`.trim();

const registrationLabel = (r: RegistrationRow) =>
  `${r.persons?.given_name ?? ''} ${r.persons?.family_name ?? ''}`.trim();

const registrationNames = (rows: RegistrationRow[]) =>
  rows.map(registrationLabel).sort((a, b) => a.localeCompare(b));

/**
 * Every slot reduced to what must survive a restore. Ids are all regenerated, so
 * the comparable identity of a slot is its position in the bracket plus the
 * result recorded there. Sorted, because row order is not part of the contract.
 */
const slotShape = (bracket: Bracket) =>
  bracket.slots
    .map((s) => `R${s.round}P${s.position} ${s.status} ${s.redScore}-${s.blueScore}`)
    .sort();

/** CSV data rows, sorted — order is not part of what a restore must reproduce. */
const sortedRows = (csv: string) => csv.split('\n').slice(1).sort();

/**
 * Exchange rows without their two id columns, as a sorted multiset.
 *
 * The ids are stripped BEFORE sorting, not after: `exchange_id` and `match_id`
 * are regenerated by a restore, so sorting on them orders the two copies
 * differently and the comparison fails on rows that are in fact identical.
 */
const exchangeFingerprint = (csv: string) =>
  csv
    .split('\n')
    .slice(1)
    .map((line) => line.split(',').slice(2).join(','))
    .sort();
