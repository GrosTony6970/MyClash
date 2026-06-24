import { test, expect, type APIResponse } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runContext } from './_context';

/**
 * Opt-in demo-data populator (run with E2E_POPULATE=1). Builds a rich,
 * inspectable, published event:
 *   - imports the roster (if the event is empty), 4 lices
 *   - 2 tournaments (Longsword Open, Sidesword Open): 32 fighters, 4 pools,
 *     deductive-afterblow scoring, pools scheduled in parallel across the 4
 *     lices, a bracket of 16
 *   - 25 referees registered + skilled + assigned across both tournaments' pools
 *   - every pool match played with a realistic mix of clean hits, afterblows
 *     and cards (yellow / red / occasional black-card forfeit) — so pools flip
 *     to completed, standings populate, and the bracket of 16 auto-populates
 *     with the real qualifiers
 *   - a workshop venue (3 areas) + 6 workshops scheduled into it at staggered
 *     times, each with a randomly-picked instructor; all published
 *   - tournaments + event published
 *
 * The API throttles writes per IP; whitelisted IPs (the organizer's network)
 * skip it. By default this runs UNPACED (fast) assuming a whitelisted IP — set
 * E2E_PACE_MS (e.g. 550) to pace under the limit from a non-whitelisted IP. It
 * is gated off normal/CI runs.
 */
const POPULATE = ['1', 'true', 'yes'].includes((process.env.E2E_POPULATE ?? '').toLowerCase());
const SKILLS = ['arbitre_declarant', 'arbitre_assesseur', 'arbitre_table'];
const COLORS = ['red', 'blue', 'green', 'amber', 'violet', 'teal', 'orange', 'gold'];
const WS_LEVELS = ['all', 'beginner', 'intermediate', 'advanced'];
const WS_TOPICS = ['Longsword', 'Sidesword', 'Rapier', 'Sabre', 'Messer', 'Dagger'];
const LOCAL_CSV = 'tests/e2e/fixtures/participants.local.csv';
const SAMPLE_CSV = 'tests/e2e/fixtures/participants.sample.csv';

type Person = { id: string; givenName: string; familyName: string; globalPersonId: string | null };

test('populate: 2 tournaments + 25 referees + 6 workshops + publish', async ({ request }) => {
  test.skip(!POPULATE, 'set E2E_POPULATE=1 to populate a demo event');
  test.setTimeout(1_800_000);

  const { eventId, orgId, orgSlug, baseURL } = runContext();
  const api = (p: string) => `/api/v1/${p}`;
  const tok = Date.now().toString(36);
  const gid = (p: Person) => p.globalPersonId ?? p.id;

  // Pace requests only when asked (E2E_PACE_MS); a whitelisted IP needs none.
  let lastAt = 0;
  const MIN_MS = Number(process.env.E2E_PACE_MS ?? '0') || 0;
  const paced = async <T>(fn: () => Promise<T>): Promise<T> => {
    const wait = lastAt + MIN_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    return fn();
  };
  const get = (u: string) => paced(() => request.get(api(u)));
  const post = (u: string, o?: Parameters<typeof request.post>[1]) =>
    paced(() => request.post(api(u), o));
  const put = (u: string, o?: Parameters<typeof request.put>[1]) =>
    paced(() => request.put(api(u), o));
  const patch = (u: string, o?: Parameters<typeof request.patch>[1]) =>
    paced(() => request.patch(api(u), o));

  const reqOk = async (res: APIResponse): Promise<APIResponse> => {
    if (!res.ok()) throw new Error(`${res.status()} ${(await res.text()).slice(0, 200)}`);
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
  const listPersons = async () =>
    (await (await reqOk(await get(`events/${eventId}/persons`))).json()) as Person[];

  // ── People: import the roster if the event is empty (1 request) ───────────────
  let persons = await listPersons();
  if (persons.length < 95) {
    const csv = existsSync(LOCAL_CSV)
      ? LOCAL_CSV
      : (process.env.E2E_PARTICIPANTS_CSV ?? SAMPLE_CSV);
    await step(`import roster (${csv})`, async () =>
      reqOk(
        await post(`events/${eventId}/persons/import`, {
          multipart: {
            file: { name: 'roster.csv', mimeType: 'text/csv', buffer: readFileSync(csv) },
          },
        }),
      ),
    );
    persons = await listPersons();
  }
  const anthony =
    persons.find((p) => /garnier/i.test(p.familyName) && /anthony/i.test(p.givenName)) ??
    persons[0];
  const rest = persons.filter((p) => p.id !== anthony.id);
  const fightersA = [anthony, ...rest.slice(0, 31)]; // 32, Longsword (incl. Anthony)
  const fightersB = rest.slice(31, 63); // 32, Sidesword
  const referees = rest.slice(63, 88); // 25
  const instructors = rest.slice(88, 94); // 6
  console.log(
    `  → ${persons.length} persons: ${fightersA.length}+${fightersB.length} fighters, ${referees.length} referees, ${instructors.length} instructors`,
  );

  // ── 4 lices ──────────────────────────────────────────────────────────────────
  const liceIds: string[] = [];
  for (let i = 1; i <= 4; i++) {
    const r = await post(`events/${eventId}/lices`, { data: { name: `Piste ${i}` } });
    if (r.ok()) liceIds.push(((await r.json()) as { id: string }).id);
  }
  console.log(`  ✓ ${liceIds.length} lices`);

  // ── Build one tournament (structure only — matches played later) ──────────────
  const buildTournament = async (
    name: string,
    weapon: string,
    fighters: Person[],
    startHour: string,
    color: string,
  ): Promise<{ id: string; poolIds: string[] }> => {
    const t = await step(`create ${name}`, async () =>
      (
        await reqOk(
          await post(`events/${eventId}/tournaments`, {
            data: { name, slug: `${weapon}-open-${tok}`, weapon, color },
          }),
        )
      ).json(),
    );
    const tournamentId = t?.id as string | undefined;
    if (!tournamentId) return { id: '', poolIds: [] };

    await step(`${name}: deductive afterblow`, async () =>
      reqOk(
        await patch(`tournaments/${tournamentId}`, {
          data: { scoringConfig: { afterblowMode: 'deductive' } },
        }),
      ),
    );

    let reg = 0;
    for (const p of fighters) {
      const r = await post(`tournaments/${tournamentId}/registrations`, {
        data: { personId: p.id },
      });
      if (r.ok()) reg++;
    }
    await step(`${name}: 4 pools`, async () =>
      reqOk(await post(`tournaments/${tournamentId}/generate-pools`, { data: { poolCount: 4 } })),
    );

    const pwm = (await (
      await reqOk(await get(`tournaments/${tournamentId}/pools-with-matches`))
    ).json()) as Array<Record<string, unknown>>;
    const poolIds = pwm
      .map((p) => (p['poolId'] ?? p['id'] ?? p['pool_id']) as string)
      .filter(Boolean);

    // One competition block for this tournament's pool phase; programme/generate
    // (after both tournaments) lays its matches across the 4 lices in parallel.
    await step(`${name}: programme block`, async () =>
      reqOk(
        await post(`events/${eventId}/programme/blocks`, {
          data: {
            dayIndex: 0,
            blockType: 'competition',
            label: name,
            startTime: `${startHour}:00`,
            endTime: `${Number(startHour) + 4}:00`,
            liceCount: liceIds.length,
            matchGapSeconds: 30,
            matchDurationMinutes: 5,
            competitionId: tournamentId,
            competitionPhase: 'pool',
          },
        }),
      ),
    );

    await step(`${name}: bracket of 16`, async () =>
      reqOk(
        await post(`tournaments/${tournamentId}/generate-bracket`, {
          data: { phaseType: 'single_elim', qualifyCount: 16, bracketSize: 16 },
        }),
      ),
    );
    console.log(`  → ${name}: ${reg} fighters, ${poolIds.length} pools, deductive afterblow`);
    return { id: tournamentId, poolIds }; // publish later — published pools aren't editable
  };

  const long = await buildTournament('Longsword Open', 'longsword', fightersA, '09', 'red');
  const side = await buildTournament('Sidesword Open', 'sidesword', fightersB, '13', 'blue');
  const allPoolIds = [...long.poolIds, ...side.poolIds];
  const tournamentIds = [long.id, side.id].filter(Boolean);

  // Schedule both tournaments' pool matches across the 4 lices (parallel).
  const gen = (await step('generate schedule across 4 lices', async () =>
    (await reqOk(await post(`events/${eventId}/programme/generate`, { data: {} }))).json(),
  )) as { matchesScheduled?: number; blockDiagnostics?: unknown } | null;
  console.log(`    ↳ matchesScheduled: ${gen?.matchesScheduled}`);

  // generate() times the matches but fans each pool across all lices; the
  // assignment board wants one pool per lice (one referee per pool), so pin
  // each pool to a single lice (round-robin → 4 lices in parallel).
  for (let i = 0; i < allPoolIds.length; i++) {
    await put(`pools/${allPoolIds[i]}/lice`, {
      data: { liceId: liceIds[i % Math.max(liceIds.length, 1)] },
    });
  }

  // ── 25 referees: register → resolve global ids → skills → assign ───────────────
  let rReg = 0;
  for (const r of referees) {
    const reg = await post(`events/${eventId}/referees/${r.id}`);
    if (reg.ok()) rReg++;
  }
  const globalOf = new Map((await listPersons()).map((p) => [p.id, p.globalPersonId ?? p.id]));
  const refId = (p: Person) => globalOf.get(p.id) ?? gid(p);
  console.log(`  ✓ registered ${rReg}/25 referees`);

  let rSkill = 0;
  for (const r of referees) {
    for (const role of SKILLS) {
      const q = await put(`events/${eventId}/referee-qualifications`, {
        data: { personId: refId(r), role, rating: 3 + Math.floor(Math.random() * 3) },
      });
      if (q.ok()) rSkill++;
    }
  }
  console.log(`  ✓ granted ${rSkill} referee skills`);

  // Assign referees to each pool's role slots via the board's manual-assign
  // endpoint (the "click a slot → pick a referee" tab action). Round-robin the
  // 25 referees across 8 pools × 3 roles.
  let assigned = 0;
  let ri = 0;
  for (const poolId of allPoolIds) {
    for (const role of SKILLS) {
      const ref = referees[ri % Math.max(referees.length, 1)];
      ri++;
      if (!ref) continue;
      const res = await post(`events/${eventId}/referee-assignments`, {
        data: { poolId, role, personId: refId(ref) },
      });
      if (res.ok()) assigned++;
      else if (assigned === 0 && ri <= 2)
        console.log(`    ↳ assign failed: ${res.status()} ${(await res.text()).slice(0, 200)}`);
    }
  }
  console.log(`  ✓ assigned ${assigned} referee slots across ${allPoolIds.length} pools`);

  // ── Play every pool match: clean hits, afterblows, cards ───────────────────────
  // Scores are derived from exchanges; the API never infers the winner, so we
  // set winnerRegistrationId explicitly and keep the winner clearly ahead on
  // clean hits (5–2) regardless of how the ruleset nets the afterblow. A black
  // card forfeits the match (opponent wins) and a 2nd black card for a fighter
  // would DQ them tournament-wide — so black cards go to distinct fighters only
  // and those matches skip the complete-PATCH (the forfeit already completed it).
  type PwmMatch = {
    id: string;
    status: string;
    red_registration_id: string | null;
    blue_registration_id: string | null;
  };
  const iso = () => new Date().toISOString();
  const exchange = (mid: string, body: Record<string, unknown>) =>
    post(`matches/${mid}/exchanges`, {
      data: { clientUuid: randomUUID(), occurredAt: iso(), ...body },
    });
  const penalty = (mid: string, body: Record<string, unknown>) =>
    post(`matches/${mid}/penalties`, {
      data: { clientUuid: randomUUID(), occurredAt: iso(), ...body },
    });

  const blackCarded = new Set<string>(); // registrations already black-carded (avoid 2nd → DQ)
  let played = 0;
  let exchangesPosted = 0;
  let cardsPosted = 0;

  const playMatch = async (m: PwmMatch, idx: number): Promise<void> => {
    const red = m.red_registration_id;
    const blue = m.blue_registration_id;
    if (!red || !blue || m.status === 'completed') return; // bye or already played

    await patch(`matches/${m.id}/status`, { data: { status: 'running' } });

    const winnerColor = idx % 2 === 0 ? 'red' : 'blue';
    const loserColor = winnerColor === 'red' ? 'blue' : 'red';
    const winnerReg = winnerColor === 'red' ? red : blue;
    const loserReg = winnerColor === 'red' ? blue : red;

    let seq = 1;
    let clock = 12_000;
    await exchange(m.id, {
      sequence: seq++,
      type: 'clean',
      firstStrikerColor: winnerColor,
      firstStrikeValue: 2,
      clockTimeMs: clock,
    });
    clock += 30_000;
    await exchange(m.id, {
      sequence: seq++,
      type: 'clean',
      firstStrikerColor: winnerColor,
      firstStrikeValue: 2,
      clockTimeMs: clock,
    });
    clock += 30_000;
    await exchange(m.id, {
      sequence: seq++,
      type: 'afterblow',
      firstStrikerColor: winnerColor,
      firstStrikeValue: 1,
      afterblowValue: 1,
      clockTimeMs: clock,
    });
    clock += 30_000;
    await exchange(m.id, {
      sequence: seq++,
      type: 'clean',
      firstStrikerColor: loserColor,
      firstStrikeValue: 1,
      clockTimeMs: clock,
    });
    exchangesPosted += 4;

    // Cards mix (penalty sequence is numbered independently of exchanges).
    let pseq = 1;
    if (idx % 41 === 0 && !blackCarded.has(loserReg)) {
      blackCarded.add(loserReg);
      await penalty(m.id, {
        sequence: pseq++,
        registrationId: loserReg,
        directCard: 'black',
        reason: 'E2E demo: black card (forfeit)',
        clockTimeMs: clock,
      });
      cardsPosted++;
      played++;
      return; // forfeit auto-completed the match (winner = opponent)
    }
    if (idx % 3 === 0) {
      await penalty(m.id, {
        sequence: pseq++,
        registrationId: loserReg,
        directCard: 'yellow',
        reason: 'E2E demo: warning',
        clockTimeMs: clock,
      });
      cardsPosted++;
    }
    if (idx % 7 === 0) {
      await penalty(m.id, {
        sequence: pseq++,
        registrationId: loserReg,
        directCard: 'red',
        reason: 'E2E demo: penalty',
        clockTimeMs: clock,
      });
      cardsPosted++;
    }

    await patch(`matches/${m.id}/status`, {
      data: { status: 'completed', winnerRegistrationId: winnerReg },
    });
    played++;
  };

  for (const tid of tournamentIds) {
    const pools = (await (
      await reqOk(await get(`tournaments/${tid}/pools-with-matches`))
    ).json()) as Array<{ matches?: PwmMatch[] }>;
    const matches = pools.flatMap((p) => p.matches ?? []);
    let idx = 0;
    for (const m of matches) {
      try {
        await playMatch(m, idx);
      } catch (e) {
        console.log(`    ✗ match ${m.id.slice(0, 8)}: ${(e as Error).message}`);
      }
      idx++;
    }
  }
  console.log(
    `  ✓ played ${played} pool matches (${exchangesPosted} exchanges, ${cardsPosted} cards)`,
  );

  // Verify pools completed + standings populated — best-effort, like the rest
  // of the populator. A standings hiccup (e.g. an un-redeployed API still
  // serving the legacy ruleset-version bug) logs a line but never fails the run.
  for (const tid of tournamentIds) {
    await step(`standings ${tid.slice(0, 8)}`, async () => {
      const res = await get(`tournaments/${tid}/pool-standings?mode=by-pool`);
      if (!res.ok()) {
        console.log(
          `    ↳ ${tid.slice(0, 8)}: ${res.status()} ${(await res.text()).slice(0, 120)}`,
        );
        return null;
      }
      const standings = (await res.json()) as {
        pools?: Array<{ poolName: string; status: string; rows: Array<{ displayName: string }> }>;
      };
      const pools = standings.pools ?? [];
      const done = pools.filter((p) => p.status === 'completed').length;
      const leader = pools[0]?.rows?.[0];
      console.log(
        `    ↳ ${tid.slice(0, 8)}: ${done}/${pools.length} pools completed` +
          (leader ? ` — ${pools[0].poolName} leader: ${leader.displayName}` : ''),
      );
      return done;
    });
  }

  // ── Workshop venue + areas, then 6 scheduled workshops ─────────────────────────
  const venue = await step('create workshop venue', async () =>
    (
      await reqOk(
        await post(`organizations/${orgId}/venues`, {
          data: { name: `Workshop Hall ${tok}`, hostsWorkshop: true },
        }),
      )
    ).json(),
  );
  const venueId = venue?.id as string | undefined;
  const areaIds: string[] = [];
  if (venueId) {
    for (let i = 1; i <= 3; i++) {
      const a = await post(`venues/${venueId}/areas`, {
        data: { name: `Area ${i}`, sortOrder: i },
      });
      if (a.ok()) areaIds.push(((await a.json()) as { id: string }).id);
    }
  }
  console.log(`  ✓ workshop venue + ${areaIds.length} areas`);

  let wMade = 0;
  for (let i = 0; i < 6; i++) {
    const instructor = instructors[i % Math.max(instructors.length, 1)];
    const ok = await step(`workshop ${i + 1}`, async () => {
      const res = await reqOk(
        await post(`events/${eventId}/workshops`, {
          data: {
            slug: `demo-ws-${tok}-${i}`,
            title: `Demo Workshop ${i + 1}`,
            durationMinutes: 45,
            level: WS_LEVELS[i % WS_LEVELS.length],
            category: WS_TOPICS[i % WS_TOPICS.length], // no weapon field on workshops; use category
            capacity: 12 + i * 2,
            color: COLORS[i % COLORS.length],
            venueId,
          },
        }),
      );
      const workshopId = ((await res.json()) as { id: string }).id;
      if (instructor) {
        await post(`events/${eventId}/instructors/${instructor.id}`);
        await post(`workshops/${workshopId}/instructors`, {
          data: { globalPersonId: refId(instructor) },
        });
      }
      // Schedule each workshop into the venue/area at a staggered time slot.
      const hour = String(9 + i).padStart(2, '0');
      await post(`workshops/${workshopId}/sessions`, {
        data: {
          startTime: `2099-01-02T${hour}:00:00Z`,
          endTime: `2099-01-02T${hour}:45:00Z`,
          venueId,
          areaId: areaIds.length ? areaIds[i % areaIds.length] : undefined,
        },
      });
      await patch(`workshops/${workshopId}`, { data: { status: 'published' } });
      return true;
    });
    if (ok) wMade++;
  }
  console.log(`  ✓ ${wMade}/6 workshops published`);

  for (const id of tournamentIds) {
    await step(`publish tournament ${id.slice(0, 8)}`, async () =>
      reqOk(await post(`tournaments/${id}/publish`)),
    );
  }
  await step('publish event', async () => reqOk(await post(`events/${eventId}/publish`)));

  console.log(
    `\n[e2e] populated demo data — inspect it:\n` +
      `        referees:    ${baseURL}/org/${orgSlug}/events/${eventId}/referees#assignments\n` +
      `        tournaments: ${baseURL}/org/${orgSlug}/events/${eventId}/tournaments  (open one → Pools for scores/standings, Bracket for qualifiers)\n` +
      `        schedule:    ${baseURL}/org/${orgSlug}/events/${eventId}/schedule\n` +
      `        workshops:   ${baseURL}/org/${orgSlug}/events/${eventId}/workshops`,
  );

  expect(allPoolIds.length).toBeGreaterThan(0);
  expect(played).toBeGreaterThan(0);
});
