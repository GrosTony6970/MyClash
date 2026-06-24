import { test, expect, type APIResponse } from '@playwright/test';
import { runContext } from './_context';

/**
 * Opt-in demo-data populator (run with E2E_POPULATE=1). Into the preserved test
 * event it builds a rich, inspectable tournament + workshop: registers Anthony
 * Garnier as a fighter AND referee, assigns referee skills + a pool, runs the
 * pool matches, creates a bracket, tags an instructor, creates + publishes a
 * workshop, and publishes the tournament + event.
 *
 * Each step is best-effort and logged (✓/✗) so a single run surfaces everything
 * that worked vs. needs attention. Scoring matches makes the event un-hard-
 * deletable by design, so this is gated off normal/CI runs.
 */
const POPULATE = ['1', 'true', 'yes'].includes((process.env.E2E_POPULATE ?? '').toLowerCase());

type Person = { id: string; givenName: string; familyName: string; globalPersonId: string | null };

test('populate: rich tournament + referees + workshop + publish', async ({ request }) => {
  test.skip(!POPULATE, 'set E2E_POPULATE=1 to populate a demo event');
  test.setTimeout(180_000);

  const { eventId, orgSlug, baseURL } = runContext();
  const api = (p: string) => `/api/v1/${p}`;
  const tok = Date.now().toString(36);

  const reqOk = async (res: APIResponse): Promise<APIResponse> => {
    if (!res.ok()) throw new Error(`${res.status()} ${(await res.text()).slice(0, 300)}`);
    return res;
  };
  const step = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      const r = await fn();
      console.log(`  ✓ ${label}`);
      return r;
    } catch (e) {
      console.log(`  ✗ ${label}: ${(e as Error).message}`);
      return null;
    }
  };

  // ── People ────────────────────────────────────────────────────────────────
  const listPersons = async () =>
    (await (await reqOk(await request.get(api(`events/${eventId}/persons`)))).json()) as Person[];
  let persons = await listPersons();
  // Standalone runs (no import spec) start empty — bootstrap a few, incl Anthony.
  if (persons.length < 4) {
    for (const [givenName, familyName] of [
      ['Anthony', 'Garnier'],
      ['Demo', 'Fighter A'],
      ['Demo', 'Fighter B'],
      ['Demo', 'Fighter C'],
    ]) {
      await request.post(api(`events/${eventId}/persons`), { data: { givenName, familyName } });
    }
    persons = await listPersons();
  }
  const anthony =
    persons.find((p) => /garnier/i.test(p.familyName) && /anthony/i.test(p.givenName)) ??
    persons[0];
  const others = persons.filter((p) => p.id !== anthony.id).slice(0, 3);
  const instructor = persons.find((p) => p.id !== anthony.id && !others.includes(p)) ?? others[0];
  console.log(`  → fighters: ${anthony.givenName} ${anthony.familyName} + ${others.length} others`);

  // ── Tournament + registrations ──────────────────────────────────────────────
  const tournament = await step('create tournament', async () =>
    (
      await reqOk(
        await request.post(api(`events/${eventId}/tournaments`), {
          data: { name: `Demo Cup ${tok}`, slug: `demo-cup-${tok}`, weapon: 'longsword' },
        }),
      )
    ).json(),
  );
  const tournamentId = tournament?.id as string | undefined;
  if (!tournamentId) return; // nothing else makes sense without it

  for (const p of [anthony, ...others]) {
    await step(`register fighter ${p.familyName}`, async () =>
      reqOk(
        await request.post(api(`tournaments/${tournamentId}/registrations`), {
          data: { personId: p.id },
        }),
      ),
    );
  }

  // ── Anthony as referee + skills ─────────────────────────────────────────────
  await step('register Anthony as referee', async () =>
    reqOk(await request.post(api(`events/${eventId}/referees/${anthony.id}`))),
  );
  await step('assign referee skill (declarant, 5)', async () =>
    reqOk(
      await request.put(api(`events/${eventId}/referee-qualifications`), {
        data: {
          personId: anthony.globalPersonId ?? anthony.id,
          role: 'arbitre_declarant',
          rating: 5,
        },
      }),
    ),
  );

  // ── Pools + run the matches ─────────────────────────────────────────────────
  await step('generate pools', async () =>
    reqOk(
      await request.post(api(`tournaments/${tournamentId}/generate-pools`), {
        data: { poolCount: 1 },
      }),
    ),
  );

  const pwm = await step('load pools-with-matches', async () =>
    (await reqOk(await request.get(api(`tournaments/${tournamentId}/pools-with-matches`)))).json(),
  );
  const pools = (Array.isArray(pwm) ? pwm : (pwm?.pools ?? [])) as Array<Record<string, unknown>>;
  const pool = pools[0];
  const poolId = (pool?.['id'] ?? pool?.['pool_id']) as string | undefined;
  const matches = ((pool?.['matches'] ?? []) as Array<Record<string, unknown>>).map((m) => ({
    id: m['id'] as string,
    red: (m['redRegistrationId'] ?? m['red_registration_id']) as string | undefined,
  }));

  if (poolId) {
    // person_id resolution for assignments is fuzzy across the schema — try the
    // global id, fall back to the event person id.
    await step('assign Anthony as pool referee', async () => {
      const body = (id: string) => ({ data: { role: 'referee', refereeId: id } });
      let res = await request.put(
        api(`pools/${poolId}/referee-role-assignments`),
        body(anthony.globalPersonId ?? anthony.id),
      );
      if (!res.ok() && anthony.globalPersonId) {
        res = await request.put(api(`pools/${poolId}/referee-role-assignments`), body(anthony.id));
      }
      return reqOk(res);
    });
  }

  let played = 0;
  for (const m of matches) {
    if (!m.id || !m.red) continue;
    const ran = await step(`run match ${played + 1}`, async () => {
      await reqOk(
        await request.patch(api(`matches/${m.id}/status`), { data: { status: 'running' } }),
      );
      return reqOk(
        await request.patch(api(`matches/${m.id}/status`), {
          data: { status: 'completed', winnerRegistrationId: m.red },
        }),
      );
    });
    if (ran) played++;
  }
  console.log(`  → ran ${played}/${matches.length} pool matches`);

  // ── Bracket ─────────────────────────────────────────────────────────────────
  await step('generate bracket', async () =>
    reqOk(
      await request.post(api(`tournaments/${tournamentId}/generate-bracket`), {
        data: { phaseType: 'single_elim', qualifyCount: 4, bracketSize: 4 },
      }),
    ),
  );
  await step('populate bracket (needs completed pools)', async () =>
    reqOk(
      await request.post(api(`tournaments/${tournamentId}/populate-bracket`), {
        data: { seedingMode: 'overall' },
      }),
    ),
  );

  // ── Instructor + workshop ────────────────────────────────────────────────────
  await step(`tag instructor ${instructor.familyName}`, async () =>
    reqOk(await request.post(api(`events/${eventId}/instructors/${instructor.id}`))),
  );
  const workshop = await step('create workshop', async () =>
    (
      await reqOk(
        await request.post(api(`events/${eventId}/workshops`), {
          data: { slug: `demo-ws-${tok}`, title: `Demo Workshop ${tok}`, durationMinutes: 60 },
        }),
      )
    ).json(),
  );
  const workshopId = workshop?.id as string | undefined;
  if (workshopId) {
    await step('add workshop instructor', async () =>
      reqOk(
        await request.post(api(`workshops/${workshopId}/instructors`), {
          data: { globalPersonId: instructor.globalPersonId ?? instructor.id },
        }),
      ),
    );
    await step('schedule workshop session', async () =>
      reqOk(
        await request.post(api(`workshops/${workshopId}/sessions`), {
          data: { startTime: '2099-01-01T10:00:00Z', endTime: '2099-01-01T11:00:00Z' },
        }),
      ),
    );
    await step('publish workshop', async () =>
      reqOk(await request.patch(api(`workshops/${workshopId}`), { data: { status: 'published' } })),
    );
  }

  // ── Publish ───────────────────────────────────────────────────────────────────
  await step('publish tournament', async () =>
    reqOk(await request.post(api(`tournaments/${tournamentId}/publish`))),
  );
  await step('publish event', async () =>
    reqOk(await request.post(api(`events/${eventId}/publish`))),
  );

  console.log(
    `\n[e2e] populated demo data — inspect it:\n` +
      `        tournament: ${baseURL}/org/${orgSlug}/events/${eventId}/tournaments\n` +
      `        schedule:   ${baseURL}/org/${orgSlug}/events/${eventId}/schedule\n` +
      `        referees:   ${baseURL}/org/${orgSlug}/events/${eventId}/referees\n` +
      `        workshops:  ${baseURL}/org/${orgSlug}/events/${eventId}/workshops`,
  );

  expect(tournamentId).toBeTruthy();
});
