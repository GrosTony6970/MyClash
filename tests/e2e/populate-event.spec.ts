import { test, expect, type APIResponse } from '@playwright/test';
import { runContext } from './_context';

/**
 * Opt-in demo-data populator (run with E2E_POPULATE=1). Into the preserved test
 * event it builds a rich, inspectable, published tournament + workshop:
 *   - registers 12 fighters (incl. Anthony Garnier) across several round-robin pools
 *   - makes Anthony a referee too (skills + pool assignment)
 *   - registers 25 more random referees, gives each all referee skills, and
 *     assigns them across the pools (manual per-pool + auto-assign engine)
 *   - runs all pool matches, then creates + populates a bracket
 *   - tags an instructor, creates + publishes a workshop
 *   - publishes the tournament + event
 *
 * Each step is best-effort and logged (✓/✗). Scoring matches makes the event
 * un-hard-deletable by design, so this is gated off normal/CI runs.
 */
const POPULATE = ['1', 'true', 'yes'].includes((process.env.E2E_POPULATE ?? '').toLowerCase());
const SKILLS = ['arbitre_declarant', 'arbitre_assesseur', 'arbitre_table'];

type Person = { id: string; givenName: string; familyName: string; globalPersonId: string | null };

test('populate: rich tournament + 25 referees + workshop + publish', async ({ request }) => {
  test.skip(!POPULATE, 'set E2E_POPULATE=1 to populate a demo event');
  test.setTimeout(240_000);

  const { eventId, orgSlug, baseURL } = runContext();
  const api = (p: string) => `/api/v1/${p}`;
  const tok = Date.now().toString(36);
  const gid = (p: Person) => p.globalPersonId ?? p.id; // referee assignments key on the global id

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

  // ── People ──────────────────────────────────────────────────────────────────
  const listPersons = async () =>
    (await (await reqOk(await request.get(api(`events/${eventId}/persons`)))).json()) as Person[];
  let persons = await listPersons();
  // Standalone runs (no import) start empty — bootstrap enough, incl. Anthony.
  if (persons.length < 45) {
    for (let i = persons.length; i < 45; i++) {
      const [givenName, familyName] = i === 0 ? ['Anthony', 'Garnier'] : [`Demo${i}`, `Person${i}`];
      await request.post(api(`events/${eventId}/persons`), { data: { givenName, familyName } });
    }
    persons = await listPersons();
  }
  const anthony =
    persons.find((p) => /garnier/i.test(p.familyName) && /anthony/i.test(p.givenName)) ??
    persons[0];
  const rest = persons.filter((p) => p.id !== anthony.id);
  const fighters = [anthony, ...rest.slice(0, 11)]; // 12 fighters incl. Anthony
  const referees = rest.slice(11, 36); // 25 distinct referees
  const instructor = rest[36] ?? rest[0];
  console.log(`  → ${fighters.length} fighters, ${referees.length} referees`);

  // ── Tournament + fighters ─────────────────────────────────────────────────────
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
  if (!tournamentId) return;

  let fReg = 0;
  for (const p of fighters) {
    const r = await request.post(api(`tournaments/${tournamentId}/registrations`), {
      data: { personId: p.id },
    });
    if (r.ok()) fReg++;
  }
  console.log(
    `  ✓ registered ${fReg}/${fighters.length} fighters (incl. ${anthony.givenName} ${anthony.familyName})`,
  );

  // ── Anthony as referee (he's also a fighter) ──────────────────────────────────
  await step('register Anthony as referee', async () =>
    reqOk(await request.post(api(`events/${eventId}/referees/${anthony.id}`))),
  );

  // ── Pools ─────────────────────────────────────────────────────────────────────
  await step('generate pools', async () =>
    reqOk(
      await request.post(api(`tournaments/${tournamentId}/generate-pools`), {
        data: { targetSize: 4 },
      }),
    ),
  );
  const pwm = await step('load pools-with-matches', async () =>
    (await reqOk(await request.get(api(`tournaments/${tournamentId}/pools-with-matches`)))).json(),
  );
  const pools = (Array.isArray(pwm) ? pwm : (pwm?.pools ?? [])) as Array<Record<string, unknown>>;
  const poolIds = pools
    .map((p) => (p['poolId'] ?? p['id'] ?? p['pool_id']) as string)
    .filter(Boolean);
  const allMatches = pools.flatMap((p) =>
    ((p['matches'] ?? []) as Array<Record<string, unknown>>).map((m) => ({
      id: m['id'] as string,
      red: (m['redRegistrationId'] ?? m['red_registration_id']) as string | undefined,
    })),
  );
  console.log(`  → ${poolIds.length} pools, ${allMatches.length} matches`);

  // ── 25 referees: register, then resolve canonical (global) ids ─────────────────
  let rReg = 0;
  for (const r of referees) {
    const reg = await request.post(api(`events/${eventId}/referees/${r.id}`));
    if (reg.ok()) rReg++;
  }
  // Registration backfills each person's global id, which the qualification +
  // assignment endpoints key on (imported rows list it null until then).
  const globalOf = new Map((await listPersons()).map((p) => [p.id, p.globalPersonId ?? p.id]));
  const refId = (p: Person) => globalOf.get(p.id) ?? gid(p);
  console.log(`  ✓ registered ${rReg}/25 referees`);

  // ── Skills: Anthony + the 25 (all three roles, random rating) ─────────────────
  let rSkill = 0;
  for (const r of [anthony, ...referees]) {
    for (const role of SKILLS) {
      const q = await request.put(api(`events/${eventId}/referee-qualifications`), {
        data: { personId: refId(r), role, rating: 3 + Math.floor(Math.random() * 3) },
      });
      if (q.ok()) rSkill++;
    }
  }
  console.log(`  ✓ granted ${rSkill} referee skills`);

  // ── Assign referees across the pools (manual round-robin + auto-assign) ─────────
  let assigned = 0;
  let ri = 0;
  for (const poolId of poolIds) {
    for (const role of SKILLS) {
      const ref = referees[ri % Math.max(referees.length, 1)];
      ri++;
      if (!ref) continue;
      const res = await request.put(api(`pools/${poolId}/referee-role-assignments`), {
        data: { role, refereeId: refId(ref) },
      });
      if (res.ok()) assigned++;
    }
  }
  // Anthony is both a fighter AND a pool referee.
  if (poolIds[0]) {
    await request.put(api(`pools/${poolIds[0]}/referee-role-assignments`), {
      data: { role: 'arbitre_declarant', refereeId: refId(anthony) },
    });
  }
  console.log(`  ✓ assigned ${assigned} pool referee slots`);
  await step('auto-assign referees (apply)', async () =>
    reqOk(await request.post(api(`events/${eventId}/auto-assign-referees?dryRun=false`))),
  );

  // ── Run all pool matches ────────────────────────────────────────────────────────
  let played = 0;
  for (const m of allMatches) {
    if (!m.id || !m.red) continue;
    try {
      await reqOk(
        await request.patch(api(`matches/${m.id}/status`), { data: { status: 'running' } }),
      );
      await reqOk(
        await request.patch(api(`matches/${m.id}/status`), {
          data: { status: 'completed', winnerRegistrationId: m.red },
        }),
      );
      played++;
    } catch {
      /* best-effort */
    }
  }
  console.log(`  ✓ ran ${played}/${allMatches.length} pool matches`);

  // ── Bracket ─────────────────────────────────────────────────────────────────────
  await step('generate bracket', async () =>
    reqOk(
      await request.post(api(`tournaments/${tournamentId}/generate-bracket`), {
        data: { phaseType: 'single_elim', qualifyCount: 8, bracketSize: 8 },
      }),
    ),
  );
  await step('populate bracket', async () =>
    reqOk(
      await request.post(api(`tournaments/${tournamentId}/populate-bracket`), {
        data: { seedingMode: 'overall' },
      }),
    ),
  );

  // ── Instructor + workshop ─────────────────────────────────────────────────────────
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
          data: { globalPersonId: gid(instructor) },
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

  // ── Publish ───────────────────────────────────────────────────────────────────────
  await step('publish tournament', async () =>
    reqOk(await request.post(api(`tournaments/${tournamentId}/publish`))),
  );
  await step('publish event', async () =>
    reqOk(await request.post(api(`events/${eventId}/publish`))),
  );

  console.log(
    `\n[e2e] populated demo data — inspect it:\n` +
      `        referees:   ${baseURL}/org/${orgSlug}/events/${eventId}/referees#assignments\n` +
      `        tournament: ${baseURL}/org/${orgSlug}/events/${eventId}/tournaments\n` +
      `        schedule:   ${baseURL}/org/${orgSlug}/events/${eventId}/schedule\n` +
      `        workshops:  ${baseURL}/org/${orgSlug}/events/${eventId}/workshops`,
  );

  expect(tournamentId).toBeTruthy();
});
