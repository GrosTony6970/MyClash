import { test, expect } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_api';
import { createBracketTournament, ensurePersons, readBracket, scoreMatch } from './_bracket';
import { parseCsvRows, readStoredZip } from './_bundle';

/**
 * Privacy: the subject data export, and the deletion-request lifecycle that
 * stands between an archived event and its destruction (run with E2E_PRIVACY=1).
 *
 * The subject export is a legal obligation (GDPR Art. 15 + 20) whose only
 * self-check is its own manifest — the service docstring calls the manifest the
 * thing that makes the export "verifiable rather than merely plausible", and
 * nothing had ever verified it. So this spec holds the bundle to its own
 * promises, byte for byte: every file the manifest names must exist, carry the
 * row count it claims, and stamp every row with the `_table` its README says is
 * there.
 *
 * Deletion requests are the opposite risk: they are the ONE thing allowed
 * through the archived-event read-only guard, so if the lifecycle breaks, an
 * archived event becomes undeletable by anyone but a super admin poking the
 * database.
 *
 * ── What this spec deliberately does NOT do ──────────────────────────────────
 *
 * Read and reversible operations only. Retention runs and person anonymisation
 * are destructive far beyond the throwaway event — and both sit behind
 * `SuperAdminGuard`, which the E2E account (an org OWNER, `isSuperAdmin: false`)
 * cannot pass. So rather than pretend to cover them, this spec pins the
 * BOUNDARY: an org owner must be refused by all three. Their behaviour stays
 * unit-tested in `erasure.service.test.ts` / `retention.service.test.ts`.
 *
 * The event-target lifecycle needs an ARCHIVED event, and archiving is one-way:
 * `PATCH events/:id` carries no `@AllowOnArchivedEvent()`, so an archived event
 * cannot be un-archived and the shared throwaway event must never be used for
 * it. This spec creates its own `event_kind: 'test'` event instead —
 * `allowsDirectHardDelete` makes exactly that kind disposable while archived, so
 * it cleans up after itself.
 */
const PRIVACY = ['1', 'true', 'yes'].includes((process.env.E2E_PRIVACY ?? '').toLowerCase());

/** `reason` must be 10..500 chars (createDeletionRequestSchema). */
const REASON = 'End-to-end privacy spec: deletion-request lifecycle probe.';

/**
 * Any UUID does for the anonymise-boundary probe: `SuperAdminGuard` runs BEFORE
 * the handler, so a refusal here proves the guard rejects without ever reaching
 * a real global person. Using a live id would risk anonymising someone if the
 * guard ever regressed — the opposite of what the assertion is for.
 */
const UNUSED_GLOBAL_PERSON_ID = '00000000-0000-4000-8000-0000000000ff';

interface MeResponse {
  type: string;
  user: { id: string; email: string };
  admin: { isSuperAdmin: boolean };
}

interface DeletionRequest {
  id: string;
  targetType: 'event' | 'tournament';
  targetId: string;
  organizationId: string;
  status: string;
  reason: string;
  requesterUserId: string;
}

interface Manifest {
  generatedAt: string;
  schemaVersion: number;
  subject: { userId: string; globalPersonIds: string[]; personIds: string[] };
  files: Record<string, { tables: string[]; rowCount: number }>;
}

const me = async (api: Api) => api.json<MeResponse>(await api.get('me'));

const activeRequest = async (api: Api, targetType: string, targetId: string) =>
  api.json<DeletionRequest | null>(
    await api.get(`deletion-requests/active?targetType=${targetType}&targetId=${targetId}`),
  );

const orgRequests = async (api: Api, orgId: string, status?: string) =>
  api.json<DeletionRequest[]>(
    await api.get(`organizations/${orgId}/deletion-requests${status ? `?status=${status}` : ''}`),
  );

test.describe('privacy', () => {
  test.skip(!PRIVACY, 'set E2E_PRIVACY=1 to download a real subject export');

  test('the subject export keeps every promise its manifest and README make', async ({
    request,
  }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);
    const { user } = await me(api);

    const response = await api.ok(await api.get('me/data-export.zip'));
    expect(response.headers()['content-type']).toContain('application/zip');
    // A personal-data bundle must never sit in a shared or browser cache.
    expect(response.headers()['cache-control']).toContain('no-store');

    const bundle = readStoredZip(await response.body());
    expect([...bundle.keys()]).toContain('README.txt');

    const manifest = JSON.parse(bundle.get('manifest.json')!) as Manifest;
    // It is the SUBJECT's bundle: the uid it declares must be the caller's.
    expect(manifest.subject.userId).toBe(user.id);
    expect(manifest.schemaVersion).toBe(1);

    // Every file the manifest names exists, and every entry is named by the
    // manifest — no silent omission in either direction.
    expect(new Set(Object.keys(manifest.files))).toEqual(
      new Set(
        [...bundle.keys()].filter((name) => name !== 'README.txt' && name !== 'manifest.json'),
      ),
    );

    for (const [name, declared] of Object.entries(manifest.files)) {
      const body = bundle.get(name)!;
      const rows = name.endsWith('.json') ? (JSON.parse(body) as unknown[]) : parseCsvRows(body);

      // The row count IS the manifest's claim. Without this the counts are
      // decoration and the subject cannot tell a complete export from a
      // truncated one.
      expect(rows, `${name} row count disagrees with the manifest`).toHaveLength(declared.rowCount);

      // "Every row carries a _table column naming its source" — README.txt.
      const tables = new Set(declared.tables);
      for (const row of rows as Array<Record<string, unknown>>) {
        expect(tables.has(String(row['_table'])), `${name}: unexpected _table`).toBe(true);
      }
    }

    // Non-empty where it must be: the caller owns this org, so their
    // organization_members row is theirs to see. An export that "verifies" only
    // empty files would satisfy everything above.
    const accountFile = Object.entries(manifest.files).find(([name]) => name === 'account.json');
    expect(accountFile, 'account.json missing from the bundle').toBeDefined();
    expect(accountFile![1].tables).toContain('organization_members');
    const accountRows = JSON.parse(bundle.get('account.json')!) as Array<Record<string, unknown>>;
    const memberships = accountRows.filter((row) => row['_table'] === 'organization_members');
    expect(memberships.length).toBeGreaterThan(0);
    for (const row of memberships) expect(row['user_id']).toBe(user.id);
  });

  test('an archived event can be deletion-requested, listed, and cancelled', async ({
    request,
  }) => {
    test.setTimeout(300_000);
    const api = apiFor(request);
    const { orgId } = runContext();
    const { user } = await me(api);

    // A disposable event of its own. Archiving is one-way, so the shared
    // throwaway event cannot be used — and `event_kind: 'test'` is the one kind
    // an org admin may hard-delete while archived, which is how this cleans up.
    const slug = `e2e-privacy-${Date.now().toString(36)}`;
    const event = await api.json<{ id: string }>(
      await api.post(`organizations/${orgId}/events`, {
        data: {
          name: `E2E TEST (auto) privacy — ${slug}`,
          slug,
          startDate: '2099-01-01',
          endDate: '2099-01-02',
          city: 'Testville',
          country: 'FR',
          eventKind: 'test',
        },
      }),
    );

    try {
      // A live event is not deletion-request material: there is nothing to
      // protect yet, and the organizer can still edit it freely.
      const tooEarly = await api.post('deletion-requests', {
        data: { targetType: 'event', targetId: event.id, reason: REASON },
      });
      expect(tooEarly.status(), 'a draft event must not accept a deletion request').toBe(400);

      await api.ok(await api.patch(`events/${event.id}`, { data: { status: 'archived' } }));
      // The read-only guard is now live: ordinary writes are refused…
      expect((await api.patch(`events/${event.id}`, { data: { city: 'Nope' } })).status()).toBe(
        403,
      );

      // …and a deletion request is the one thing that still gets through.
      const created = await api.json<DeletionRequest>(
        await api.post('deletion-requests', {
          data: { targetType: 'event', targetId: event.id, reason: REASON },
        }),
      );
      expect(created.status).toBe('pending');
      expect(created.targetId).toBe(event.id);
      expect(created.requesterUserId).toBe(user.id);
      expect(created.reason).toBe(REASON);

      // One pending request per target, enforced by a partial unique index — so
      // a double submit is a conflict, not a second row that would break the
      // single-row `active` lookup.
      const duplicate = await api.post('deletion-requests', {
        data: { targetType: 'event', targetId: event.id, reason: REASON },
      });
      expect(duplicate.status(), 'a second pending request must conflict').toBe(409);

      expect((await activeRequest(api, 'event', event.id))?.id).toBe(created.id);
      expect((await orgRequests(api, orgId, 'pending')).map((r) => r.id)).toContain(created.id);

      const cancelled = await api.patch(`deletion-requests/${created.id}/cancel`);
      expect(cancelled.status()).toBe(204);

      // Cancelling releases the target and is visible in both views.
      expect(await activeRequest(api, 'event', event.id)).toBeNull();
      expect((await orgRequests(api, orgId, 'cancelled')).map((r) => r.id)).toContain(created.id);
      expect((await orgRequests(api, orgId, 'pending')).map((r) => r.id)).not.toContain(created.id);

      // Only pending requests can be cancelled.
      expect((await api.patch(`deletion-requests/${created.id}/cancel`)).status()).toBe(400);
    } finally {
      // A test event is disposable by design, archived or not.
      const deleted = await api.delete(`events/${event.id}?mode=hard`);
      if (!deleted.ok()) {
        console.warn(`[e2e] could not delete privacy event ${event.id}: ${deleted.status()}`);
      }
    }
  });

  test('a tournament becomes deletion-requestable once it holds scored matches', async ({
    request,
  }) => {
    test.setTimeout(600_000);
    const api = apiFor(request);
    const { eventId, orgId } = runContext();

    const fighters = await ensurePersons(api, eventId, 8);
    const tournament = await createBracketTournament(api, eventId, {
      name: 'Privacy — deletion eligibility',
      slug: `e2e-privacy-t-${Date.now().toString(36)}`,
      fighters,
    });

    // A draft tournament with nothing played is not eligible: it is still a plan,
    // and the organizer can simply delete it.
    const beforePlay = await api.post('deletion-requests', {
      data: { targetType: 'tournament', targetId: tournament.id, reason: REASON },
    });
    // Status only: production masks 400 detail down to a bare "Bad Request", so
    // the refusal REASON is not observable from here. That masking is why this
    // spec cannot distinguish "not eligible" from a malformed query, and why the
    // decisive assertion is the positive one below — a tournament that IS
    // eligible must be accepted.
    expect(beforePlay.status(), 'an unplayed draft tournament must not be eligible').toBe(400);

    await api.ok(
      await api.post(`tournaments/${tournament.id}/generate-bracket`, {
        data: {
          phaseType: 'double_elim',
          qualifyCount: 8,
          secondChanceTarget: 'bronze',
          bronzeMatch: true,
        },
      }),
    );
    await api.ok(await api.post(`tournaments/${tournament.id}/populate-bracket`, { data: {} }));

    // Generating a bracket pre-creates every match as `scheduled`, which is not
    // a result — the tournament must still be ineligible.
    const scheduledOnly = await api.post('deletion-requests', {
      data: { targetType: 'tournament', targetId: tournament.id, reason: REASON },
    });
    expect(scheduledOnly.status(), 'scheduled matches are not results').toBe(400);

    // Score ONE match. The tournament is still `draft`, so eligibility can only
    // come from the recorded result — which is the branch this drives.
    const bracket = await readBracket(api, tournament.id);
    const playable = bracket.slots.find(
      (slot) => slot.matchId && slot.redRegistrationId && slot.blueRegistrationId,
    );
    expect(playable, 'the populated bracket has no playable slot').toBeDefined();
    await scoreMatch(api, playable!.matchId!, 'red');

    const created = await api.json<DeletionRequest>(
      await api.post('deletion-requests', {
        data: { targetType: 'tournament', targetId: tournament.id, reason: REASON },
      }),
    );
    expect(created.targetType).toBe('tournament');
    expect(created.status).toBe('pending');
    // The request is filed against the tournament's ORGANIZATION, resolved
    // through its event — a tournament carries no organization of its own.
    expect(created.organizationId).toBe(orgId);
    expect((await activeRequest(api, 'tournament', tournament.id))?.id).toBe(created.id);

    // Leave nothing pending behind: a pending request would block a rerun in
    // the same preserved event.
    expect((await api.patch(`deletion-requests/${created.id}/cancel`)).status()).toBe(204);
    expect(await activeRequest(api, 'tournament', tournament.id)).toBeNull();
  });

  test('the destructive privacy endpoints refuse an org owner', async ({ request }) => {
    test.setTimeout(120_000);
    const api = apiFor(request);
    const { admin } = await me(api);
    // Only meaningful for a non-super-admin — and a safety interlock: these
    // routes wipe real data, so they must never actually be invoked by a run
    // whose credentials happen to carry platform rights.
    test.skip(
      admin.isSuperAdmin,
      'E2E account is a super admin; refusing to invoke retention/anonymise for real',
    );

    for (const probe of [
      { method: 'get' as const, path: 'admin/data-retention' },
      { method: 'post' as const, path: 'admin/data-retention/run' },
      {
        method: 'post' as const,
        path: `admin/global-persons/${UNUSED_GLOBAL_PERSON_ID}/anonymise`,
      },
    ]) {
      const response =
        probe.method === 'get' ? await api.get(probe.path) : await api.post(probe.path);
      expect(response.status(), `${probe.path} must be super-admin only`).toBe(403);
    }
  });
});
