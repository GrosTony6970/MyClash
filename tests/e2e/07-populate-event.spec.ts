import { test, expect, type APIResponse } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runContext } from './_context';

/**
 * Opt-in demo-data populator (run with E2E_POPULATE=1). Builds a rich,
 * inspectable, published event "Fosse aux Lions 2027" (22–23 May 2027):
 *   - imports the roster (if the event is empty)
 *   - a tournament venue (Centre Sportif et de Loisirs) with 4 lices, and the
 *     day-1 organisational blocks (Registration & Gear Check, Referee meeting)
 *   - 2 tournaments (Longsword Open, Sidesword Open): 32 fighters, 4 pools,
 *     deductive-afterblow scoring, pools scheduled in parallel across the 4
 *     lices, a bracket of 16; both tournaments' phases assigned to the venue
 *   - 25 referees registered + skilled + assigned across both tournaments' pools
 *   - every pool match played with a realistic mix of clean hits, afterblows
 *     and cards (yellow / red / occasional black-card forfeit) — so pools flip
 *     to completed, standings populate, and the bracket of 16 auto-populates
 *     with the real qualifiers
 *   - a separate workshop venue (Gymnase des Cerisiers, 1 area) + 6 workshops
 *     spread evenly across both days (3/day), each 2h, with a 12:00–14:00 midday
 *     break, each with a randomly-picked instructor; all published
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
// All six are active shared weapon_catalog names, so they pass the strict
// catalog validation on the workshop weapon field (mig 0130 + 0133).
const WS_TOPICS = ['Longsword', 'Sidesword', 'Rapier', 'Sabre', 'Messer', 'Dagger'];
const WS_CATEGORIES = ['Technique', 'Sparring', 'Drills'];
const LOCAL_CSV = 'tests/e2e/fixtures/participants.local.csv';
const SAMPLE_CSV = 'tests/e2e/fixtures/participants.sample.csv';

// Workshop scheduling: the 6 workshops are spread evenly (3/day) across the two
// event days, each lasting 2h, leaving the 12:00–14:00 midday break free. The
// single workshop area means sessions can't overlap, so the per-day start times
// are sequential and straddle the break.
const EVENT_TZ = 'Europe/Paris'; // events default to Europe/Paris (0102_events_timezone)
const WS_DAYS = ['2027-05-22', '2027-05-23']; // Sat, Sun
const WS_START_HHMM = ['10:00', '14:00', '16:00']; // → 10:00–12:00, 14:00–16:00, 16:00–18:00
const WS_DURATION_MIN = 120;

/**
 * DST-correct wall-clock (in `tz`) → UTC ISO instant. Mirrors @myclash/time's
 * `zonedToUtcIso`; inlined to avoid a workspace-package import in the e2e runner.
 * Workshop sessions are stored as UTC instants but the board (and the workshop
 * break, given as HH:MM) render in the event timezone, so session times MUST be
 * built in the event tz or they'd drift relative to the break.
 */
function zonedToUtcIso(day: string, hhmm: string, tz: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const [Y, Mo, D] = day.split('-').map(Number);
  const guess = Date.UTC(Y, Mo - 1, D, h, m);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const seen = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return new Date(guess - (seen - guess)).toISOString(); // subtract the tz offset
}

type Person = { id: string; givenName: string; familyName: string; globalPersonId: string | null };

test('populate: 2 tournaments + 25 referees + 6 workshops + publish', async ({ request }) => {
  test.skip(!POPULATE, 'set E2E_POPULATE=1 to populate a demo event');
  test.setTimeout(1_800_000);

  const { eventId, orgId, orgSlug, baseURL } = runContext();
  const api = (p: string) => `/api/v1/${p}`;
  const tok = Date.now().toString(36);
  const gid = (p: Person) => p.globalPersonId ?? p.id;

  // Tournament-wide double cap (also the TF_v1 default): reaching this many
  // doubles in ONE match auto-completes it as a 0–0 double loss. ONLY the
  // dedicated pool "double out" matches post this many. Every other match —
  // every bracket match and every normal pool match — posts at most ONE double,
  // which is strictly below the cap, so a double-out can never happen outside a
  // pool (a null winner would otherwise be unable to advance a bracket slot).
  const DOUBLE_CAP = 4;

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
  // 15 people deliberately compete in BOTH tournaments AND referee — overlap that
  // exercises the referee-assignment model (a competitor who is also an official,
  // e.g. someone refereeing a pool they don't fight in). Anthony fights Longsword
  // and is also a referee.
  const shared = rest.slice(0, 15); // in Longsword + Sidesword + referees
  const aOnly = rest.slice(15, 31); // 16 → Longsword only
  const bOnly = rest.slice(31, 48); // 17 → Sidesword only
  // 12 PURE (non-fighting) referees — the max concurrent slots in any window
  // (4 lices × 3 roles). They're free in every window (pools day 1, bracket day 2),
  // so 12 are exactly enough to fill every position; the 15 shared + Anthony also
  // referee but fight the day-1 pools, so they can't cover those parallel windows.
  const refOnly = rest.slice(48, 60); // 12 → referee only (free all day)
  const instructors = rest.slice(60, 66); // 6 → workshop instructors
  const extras = rest.slice(66); // leftover roster → tournament waiting lists
  const fightersA = [anthony, ...shared, ...aOnly]; // 32, Longsword (incl. Anthony)
  const fightersB = [...shared, ...bOnly]; // 32, Sidesword
  const referees = [anthony, ...shared, ...refOnly]; // 28 (Anthony + 15 shared + 12 pure)
  console.log(
    `  → ${persons.length} persons: ${fightersA.length}+${fightersB.length} fighters, ${referees.length} referees, ${instructors.length} instructors ` +
      `(${shared.length} fight both tournaments AND referee; Anthony fights + referees)`,
  );

  // ── Scripted competitors: David Perchais + Robin Rabechault ───────────────────
  // Each competes in Longsword (eliminated at the quarter-final), referees both
  // tournaments, and is an instructor. Force each into the Longsword roster + the
  // referee list (deduped; keep Longsword ≤32 by dropping a plain filler), and
  // remove them from Sidesword so they only compete in Longsword.
  const david =
    persons.find((p) => /perchais/i.test(p.familyName) && /david/i.test(p.givenName)) ?? null;
  const robin = persons.find((p) => /rabechault/i.test(p.familyName)) ?? null;
  const scripted = [david, robin].filter((p): p is Person => p !== null);
  for (const s of scripted) {
    const bIdx = fightersB.findIndex((p) => p.id === s.id);
    if (bIdx >= 0) fightersB.splice(bIdx, 1);
    if (!fightersA.some((p) => p.id === s.id)) {
      const dropIdx = fightersA.findIndex(
        (p) => p.id !== anthony.id && !scripted.some((x) => x.id === p.id),
      );
      if (dropIdx >= 0) fightersA.splice(dropIdx, 1);
      fightersA.push(s);
    }
    if (!referees.some((p) => p.id === s.id)) referees.push(s);
  }
  console.log(
    `  → scripted competitors: ${scripted.map((s) => `${s.givenName} ${s.familyName}`).join(', ') || '(none found)'}`,
  );

  // ── Rebrand the throwaway event for the demo (name + place + a 2-day window) ──
  //    country is an ISO 3166-1 alpha-2 code ('FR'); the public UI renders it via
  //    formatCountryName('FR', locale) → "France".
  await step('event → Fosse aux Lions 2027, Lyon FR (22–23 May 2027)', async () =>
    reqOk(
      await patch(`events/${eventId}`, {
        data: {
          name: 'Fosse aux Lions 2027',
          city: 'Lyon',
          country: 'FR',
          startDate: '2027-05-22',
          endDate: '2027-05-23',
        },
      }),
    ),
  );

  // Give the event a human slug (web-public serves it at /e/<slug>); otherwise the
  // throwaway `e2e--<token>` slug from global-setup is what shows in the URL. Slugs are
  // org-scoped UNIQUE and demo events persist (scored → undeletable), so fall back to a
  // token-suffixed slug when the clean one is already taken by a prior run. Its own
  // best-effort step: an API predating slug-in-update rejects it (400) and this logs ✗
  // without touching the rename above.
  let eventSlugSet: string | null = null;
  await step('event slug → fosse-aux-lions-2027', async () => {
    const base = 'fosse-aux-lions-2027';
    let slug = base;
    let res = await patch(`events/${eventId}`, { data: { slug } });
    if (res.status() === 409) {
      slug = `${base}-${tok}`;
      res = await patch(`events/${eventId}`, { data: { slug } });
    }
    await reqOk(res);
    eventSlugSet = slug;
    return slug;
  });

  // ── Venue find-or-create ─────────────────────────────────────────────────────
  // Venues are org-scoped and UNIQUE(organization_id, name); they persist across
  // runs (and can't be deleted once their lices have scored matches). So the demo
  // names stay clean (no per-run token) and uniqueness is met by REUSING an
  // existing venue / area by name rather than recreating it (which would 409).
  // Event lices have no unique constraint and are recreated for each fresh event,
  // so pointing this run's lices at a reused venue is safe.
  const findOrCreateVenue = async (data: {
    name: string;
    address: string;
    hostsTournament: boolean;
    hostsWorkshop: boolean;
  }): Promise<{ id: string; name: string }> => {
    const existing = (
      (await (await reqOk(await get(`organizations/${orgId}/venues`))).json()) as Array<{
        id: string;
        name: string;
      }>
    ).find((v) => v.name === data.name);
    if (existing) return existing;
    return (await reqOk(await post(`organizations/${orgId}/venues`, { data }))).json();
  };
  const findOrCreateArea = async (
    venueId: string,
    data: { name: string; sortOrder: number },
  ): Promise<{ id: string } | null> => {
    const vRes = await get(`venues/${venueId}`);
    if (vRes.ok()) {
      const venue = (await vRes.json()) as { venue_areas?: Array<{ id: string; name: string }> };
      const existing = (venue.venue_areas ?? []).find((a) => a.name === data.name);
      if (existing) return existing;
    }
    const aRes = await post(`venues/${venueId}/areas`, { data });
    return aRes.ok() ? ((await aRes.json()) as { id: string }) : null;
  };

  // ── Tournament venue (Centre Sportif et de Loisirs) with 4 lices ─────────────
  // The 4 event lices are created AT this venue, so every match's venue derives
  // via matches.lice_id → lices.venue_id. Each tournament's phases are then
  // pinned to it below via PUT /tournaments/:id/phase-venues.
  const tournamentVenue = await step('create tournament venue', async () =>
    findOrCreateVenue({
      name: 'Centre Sportif et de Loisirs',
      address: 'Rue Jean Rigaud, 69130 Écully',
      hostsTournament: true,
      hostsWorkshop: false,
    }),
  );
  const tournamentVenueId = tournamentVenue?.id as string | undefined;

  const liceIds: string[] = [];
  for (let i = 1; i <= 4; i++) {
    const r = await post(`events/${eventId}/lices`, {
      data: { name: `Lice ${i}`, venueId: tournamentVenueId },
    });
    if (r.ok()) liceIds.push(((await r.json()) as { id: string }).id);
  }
  console.log(`  ✓ tournament venue + ${liceIds.length} lices`);

  // ── Day-0 organisational blocks, before the pools. sort_order is assigned in
  //    creation order, so these (created first) land at the top of the day. ──────
  const adminBlock = (label: string, startTime: string, endTime: string) =>
    step(`programme block: ${label}`, async () =>
      reqOk(
        await post(`events/${eventId}/programme/blocks`, {
          data: { dayIndex: 0, blockType: 'admin', label, startTime, endTime },
        }),
      ),
    );
  await adminBlock('Registration & Gear Check', '08:00', '08:45');
  await adminBlock('Referee meeting', '08:45', '09:00');

  // Default penalty ruleset = the built-in FFAMHE one, mirroring what the
  // create-tournament wizard pre-selects (apps/web-admin .../_wizard/wizard-defaults.ts:
  // prefer built_in, else code 'ffamhe_tf_2026'). null → omit it and let the API
  // apply the built-in default at runtime.
  const penaltyRulesetId =
    (await step('resolve default penalty ruleset', async () => {
      const list = (await (await reqOk(await get('penalty-rulesets'))).json()) as Array<{
        id: string;
        built_in?: boolean;
        code?: string;
      }>;
      const def = list.find((r) => r.built_in) ?? list.find((r) => r.code === 'ffamhe_tf_2026');
      if (!def) throw new Error('no built-in penalty ruleset visible');
      return def.id;
    })) ?? null;

  // Pull the chosen ruleset's penalty ENTRIES so matches card fighters with real
  // FFAMHE infractions (rulesetEntryId) instead of manual directCards — the API
  // derives the card from each entry's `sanctions` escalation ladder by how many
  // times that fighter has been penalised in the same group this match. Bucket by
  // first-occurrence card to keep the cosmetic winner-ahead invariant (red/black
  // deduct from the CARDED fighter): first-yellow entries are safe on anyone; a red
  // comes from repeating a yellow→red entry on the loser; black (disqualifying)
  // entries feed only the rare loser forfeit.
  type PenaltyEntry = { id: string; sanctions: string[] };
  const penaltyEntries =
    (penaltyRulesetId
      ? await step('load penalty ruleset entries', async () => {
          const ruleset = (await (
            await reqOk(await get(`penalty-rulesets/${penaltyRulesetId}`))
          ).json()) as { penalty_ruleset_entries?: PenaltyEntry[] };
          return ruleset.penalty_ruleset_entries ?? [];
        })
      : null) ?? [];
  const yellowEntries = penaltyEntries.filter((e) => e.sanctions?.[0] === 'yellow');
  const escalatingEntries = yellowEntries.filter((e) => e.sanctions?.[1] === 'red');
  const blackEntries = penaltyEntries.filter((e) => e.sanctions?.[0] === 'black');
  const pickEntry = (arr: PenaltyEntry[]): PenaltyEntry | null =>
    arr.length ? arr[Math.floor(Math.random() * arr.length)]! : null;
  console.log(
    `  ✓ penalty entries: ${penaltyEntries.length} ` +
      `(${yellowEntries.length} yellow-first, ${escalatingEntries.length} yellow→red, ${blackEntries.length} disqualifying)`,
  );

  // ── Build one tournament (structure only — matches played later) ──────────────
  const buildTournament = async (
    name: string,
    weapon: string,
    fighters: Person[],
    waitlist: Person[],
    startHour: string,
    color: string,
  ): Promise<{ id: string; poolIds: string[] }> => {
    const t = await step(`create ${name}`, async () =>
      (
        await reqOk(
          await post(`events/${eventId}/tournaments`, {
            data: {
              name,
              slug: `${weapon}-open-${tok}`,
              weapon,
              color,
              // Cap at 32 seats with a 10-deep waiting list, default penalty ruleset.
              maxParticipants: 32,
              maxWaitlist: 10,
              ...(penaltyRulesetId ? { penaltyRulesetId } : {}),
            },
          }),
        )
      ).json(),
    );
    const tournamentId = t?.id as string | undefined;
    if (!tournamentId) return { id: '', poolIds: [] };

    await step(`${name}: deductive afterblow + double cap ${DOUBLE_CAP}`, async () =>
      reqOk(
        await patch(`tournaments/${tournamentId}`, {
          data: {
            scoringConfig: { afterblowMode: 'deductive' },
            // Explicit double cap (also the TF_v1 default) so the pool "double
            // out" matches below deterministically end as a 0–0 double loss.
            rulesetConfig: { matchFormat: { maxDoubleHits: DOUBLE_CAP } },
          },
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
    // Seat a few extras on the waiting list (the 32 fighters fill maxParticipants,
    // so these go via the dedicated waitlist endpoint, not the registration cap).
    let wl = 0;
    for (const p of waitlist) {
      const r = await post(`tournaments/${tournamentId}/waitlist`, {
        data: { personId: p.id },
      });
      if (r.ok()) wl++;
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
            // No fighter rest for the demo (default is 10 min) so each pool's
            // matches run back-to-back and render as ONE continuous card per
            // pool instead of being split into rest-separated blocks.
            minRestMinutes: 0,
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
    console.log(
      `  → ${name}: ${reg} fighters, ${poolIds.length} pools, ${wl} waitlisted, deductive afterblow`,
    );
    return { id: tournamentId, poolIds }; // publish later — published pools aren't editable
  };

  // Longsword pools at 09:00 (right after the 08:00–09:00 admin blocks),
  // Sidesword pools at 13:00. The admin blocks are created first, so they get the
  // lowest sort_order; programme/generate sweeps blocks in (day, sort_order) order
  // with a running cursor that only ever pushes a block LATER (never earlier), so
  // pool matches can never land before 09:00 — i.e. they never overlap
  // Registration & Gear Check or the Referee meeting.
  const long = await buildTournament(
    'Longsword Open',
    'longsword',
    fightersA,
    extras.slice(0, 6),
    '09',
    'red',
  );

  // Capture the scripted fighters' Longsword registration ids and force them into
  // DIFFERENT pools (so both can sweep → overall ranks 1-2 → opposite bracket
  // halves → they never meet before the final). Must run before any pool scores.
  let davidRegId: string | null = null;
  let robinRegId: string | null = null;
  if (long.id && scripted.length) {
    const regs = (await (
      await reqOk(await get(`tournaments/${long.id}/registrations`))
    ).json()) as Array<{
      id: string;
      persons?: { given_name?: string; family_name?: string } | null;
    }>;
    const regIdOf = (fam: RegExp, giv?: RegExp): string | null =>
      regs.find(
        (r) =>
          r.persons &&
          fam.test(r.persons.family_name ?? '') &&
          (!giv || giv.test(r.persons.given_name ?? '')),
      )?.id ?? null;
    davidRegId = david ? regIdOf(/perchais/i, /david/i) : null;
    robinRegId = robin ? regIdOf(/rabechault/i) : null;

    await step('scripted: David & Robin into different pools', async () => {
      const pwm = (await (
        await reqOk(await get(`tournaments/${long.id}/pools-with-matches`))
      ).json()) as Array<{
        poolId?: string;
        id?: string;
        pool_id?: string;
        matches?: Array<{
          red_registration_id: string | null;
          blue_registration_id: string | null;
        }>;
      }>;
      const pid = (p: (typeof pwm)[number]): string => (p.poolId ?? p.id ?? p.pool_id) as string;
      const poolOf = (regId: string | null) =>
        regId
          ? pwm.find((p) =>
              (p.matches ?? []).some(
                (m) => m.red_registration_id === regId || m.blue_registration_id === regId,
              ),
            )
          : undefined;
      const davidPool = poolOf(davidRegId);
      const robinPool = poolOf(robinRegId);
      const sharePool = davidPool && robinPool && pid(davidPool) === pid(robinPool);
      if (sharePool && robinRegId) {
        const other = pwm.find((p) => pid(p) !== pid(davidPool!));
        if (other) {
          await reqOk(
            await post(`pools/${pid(other)}/members`, { data: { registrationId: robinRegId } }),
          );
        }
      }
      console.log(
        `    ↳ David reg=${davidRegId?.slice(0, 8) ?? '—'}, Robin reg=${robinRegId?.slice(0, 8) ?? '—'}` +
          `${sharePool ? ' (moved apart)' : ''}`,
      );
      return true;
    });
  }
  // Lunch break between the two tournaments. Created BETWEEN the buildTournament
  // calls so its sort_order lands between the Longsword (sort_order 2) and
  // Sidesword (sort_order 4) pool blocks; generate's cursor slides it to 12:00
  // (or later if Longsword overran) and parks the cursor at 13:00 for Sidesword.
  // A 'break' block needs only day/type/label/start/end — no lice/match fields.
  await step('programme block: Lunch break', async () =>
    reqOk(
      await post(`events/${eventId}/programme/blocks`, {
        data: {
          dayIndex: 0,
          blockType: 'break',
          label: 'Lunch break',
          startTime: '12:00',
          endTime: '13:00',
        },
      }),
    ),
  );
  const side = await buildTournament(
    'Sidesword Open',
    'sidesword',
    fightersB,
    extras.slice(6, 12),
    '13',
    'blue',
  );
  const allPoolIds = [...long.poolIds, ...side.poolIds];
  const tournamentIds = [long.id, side.id].filter(Boolean);

  // Assign each tournament's phases (pools + bracket) to the tournament venue —
  // exercises the per-phase venue feature and links the venue to the event.
  if (tournamentVenueId) {
    for (const id of tournamentIds) {
      await step(`assign ${id.slice(0, 8)} → tournament venue`, async () =>
        reqOk(
          await put(`tournaments/${id}/phase-venues`, {
            data: { pool: tournamentVenueId, bracket: tournamentVenueId },
          }),
        ),
      );
    }
  }

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

  // ── Referees: register → resolve global ids → grant every qualification ────────
  // Assignment (fillReferees) runs per phase, once that phase is scheduled: pools
  // before they're played, the bracket after it's populated + scheduled — the
  // conflict-aware board only exposes matches that already have a time slot.
  let rReg = 0;
  for (const r of referees) {
    const reg = await post(`events/${eventId}/referees/${r.id}`);
    if (reg.ok()) rReg++;
  }
  const globalOf = new Map((await listPersons()).map((p) => [p.id, p.globalPersonId ?? p.id]));
  const refId = (p: Person) => globalOf.get(p.id) ?? gid(p);
  console.log(`  ✓ registered ${rReg}/${referees.length} referees`);

  let rSkill = 0;
  for (const r of referees) {
    for (const role of SKILLS) {
      const q = await put(`events/${eventId}/referee-qualifications`, {
        data: { personId: refId(r), role, rating: 3 + Math.floor(Math.random() * 3) },
      });
      if (q.ok()) rSkill++;
    }
  }
  console.log(`  ✓ granted ${rSkill} referee skills (all 3 roles each → interchangeable)`);

  // ── Scripted referees: David & Robin referee a Sidesword pool + a Longsword SF ──
  // Sidesword pool (day-1 afternoon) is conflict-free (they don't fight Sidesword).
  // The Longsword semi-final (round 3) match rows already exist (generate-bracket)
  // with lice_id still null — required by the match-scope CHECK — and both lose their
  // QF so they never fight the SF. Done before fillReferees to avoid double-booking.
  if (scripted.length && long.id) {
    await step('scripted: David & Robin referee both tournaments', async () => {
      const lsRes = await get(`tournaments/${long.id}/bracket`);
      const lsBracket = lsRes.ok()
        ? ((await lsRes.json()) as { slots: Array<{ round: number; matchId: string | null }> })
        : { slots: [] };
      const sfMatchIds = lsBracket.slots
        .filter((s) => s.round === 3 && s.matchId)
        .map((s) => s.matchId as string);
      for (let i = 0; i < scripted.length; i++) {
        const g = refId(scripted[i]);
        const swPool = side.poolIds[i % Math.max(side.poolIds.length, 1)];
        if (swPool) {
          const r = await post(`events/${eventId}/referee-assignments`, {
            data: { poolId: swPool, role: 'arbitre_declarant', personId: g },
          });
          if (!r.ok()) console.log(`    ✗ ${scripted[i].familyName} Sidesword ref: ${r.status()}`);
        }
        const sf = sfMatchIds[i % Math.max(sfMatchIds.length, 1)];
        if (sf) {
          // Longsword semi-final (round 3) — David/Robin lost their QF so they never
          // fight it. Role-scoped per-match referee (person_id = global id); the
          // service now writes lice_id null itself, so no pre-null needed.
          const r = await put(`matches/${sf}/referee-role-assignments`, {
            data: { role: 'arbitre_declarant', refereeId: g },
          });
          if (!r.ok())
            console.log(`    ✗ ${scripted[i].familyName} Longsword SF ref: ${r.status()}`);
          else
            console.log(
              `    ✓ ${scripted[i].familyName} Longsword SF ref (match ${sf.slice(0, 8)})`,
            );
        }
      }
      return true;
    });
  }

  // Fill referee slots from the conflict-aware assignment board: the product's
  // auto-assign engine does a bulk pass, then a deterministic top-up assigns each
  // still-open slot from its board-computed `candidates.recommended` (already filtered
  // for fighting / double-booking / qualification), re-reading the board each pass so
  // freshly-used referees drop out. Called once per phase (pools, then bracket); the
  // top-up only fills EMPTY slots, so a later pass never disturbs earlier assignments.
  type BoardSlot = {
    role: string;
    assignment: unknown | null;
    candidates?: { recommended?: Array<{ personId: string }> };
  };
  type BoardPool = { id: string; roleSlots: BoardSlot[] };
  const getBoard = async () =>
    (await (await reqOk(await get(`events/${eventId}/referee-assignment-board`))).json()) as {
      pools: BoardPool[];
      unscheduledPools?: BoardPool[];
    };
  const fillReferees = async (label: string): Promise<void> => {
    await step(`auto-assign referees (${label})`, async () =>
      reqOk(await post(`events/${eventId}/auto-assign-referees?dryRun=false`)),
    );
    for (let pass = 0; pass < 20; pass++) {
      const board = await getBoard();
      const open = board.pools.flatMap((p) =>
        p.roleSlots
          .filter((s) => !s.assignment)
          .map((s) => ({
            poolId: p.id,
            role: s.role,
            recommended: s.candidates?.recommended ?? [],
          })),
      );
      if (open.length === 0) break;
      const usedThisPass = new Set<string>();
      let did = 0;
      for (const slot of open) {
        const cand = slot.recommended.find((c) => !usedThisPass.has(c.personId));
        if (!cand) continue;
        usedThisPass.add(cand.personId);
        const res = await post(`events/${eventId}/referee-assignments`, {
          data: { poolId: slot.poolId, role: slot.role, personId: cand.personId },
        });
        if (res.ok()) did++;
      }
      if (did === 0) break; // remaining open slots have no available candidate
    }
    const finalBoard = await getBoard();
    const allSlots = finalBoard.pools.flatMap((p) => p.roleSlots);
    const filled = allSlots.filter((s) => s.assignment).length;
    console.log(
      `  ✓ referees (${label}): ${filled}/${allSlots.length} slots filled` +
        (filled < allSlots.length ? ` (${allSlots.length - filled} unfillable)` : ''),
    );
  };

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

  // Anchor each exchange/penalty's occurred_at to the REAL schedule so the data reads
  // like a live event: occurred_at = the match's start instant + its match-clock
  // offset (clockTimeMs). `matchBaseMs` is the current match's start (epoch ms), set
  // per match by playMatch / playBracketMatch. Pools use their real scheduled_at
  // (fetched into `scheduledByMatchId` before play); brackets use their day-2 block
  // slot (they're only scheduled AFTER they're played). recorded_at / started_at /
  // ended_at stay server-stamped — the API owns them and nothing renders them.
  const scheduledByMatchId = new Map<string, string>();
  let matchBaseMs: number | null = null;
  const occurredAtFor = (body: Record<string, unknown>): string => {
    const c = body['clockTimeMs'];
    return matchBaseMs != null && typeof c === 'number'
      ? new Date(matchBaseMs + c).toISOString()
      : iso();
  };
  const exchange = (mid: string, body: Record<string, unknown>) =>
    post(`matches/${mid}/exchanges`, {
      data: { clientUuid: randomUUID(), occurredAt: occurredAtFor(body), ...body },
    });
  const penalty = (mid: string, body: Record<string, unknown>) =>
    post(`matches/${mid}/penalties`, {
      data: { clientUuid: randomUUID(), occurredAt: occurredAtFor(body), ...body },
    });

  // Realistic refereeing cadence: advances clockTimeMs, which drives both the visible
  // match-clock label (MM:SS) and — via the anchor above — the occurred_at instants.
  // A HEMA phrase + reset is a few active seconds; a card pauses the bout.
  const gapMs = () => 6_000 + Math.floor(Math.random() * 16_000); // 6..22s between actions
  const cardPauseMs = () => 20_000 + Math.floor(Math.random() * 25_000); // 20..45s for a card

  // epoch ms for a match's wall-clock start: its real scheduled_at when known, else a
  // computed day/slot base (brackets, scheduled only after play) plus an offset.
  const baseMsOf = (matchId: string, day: string, hhmm: string, offsetMs: number): number => {
    const sched = scheduledByMatchId.get(matchId);
    if (sched) return Date.parse(sched);
    return Date.parse(zonedToUtcIso(day, hhmm, EVENT_TZ)) + offsetMs;
  };
  // Day-2 bracket block start hour per tournament — shared by the occurred_at anchor
  // and the bracket programme block below so they agree.
  const bracketStartHour = (name: string) => (name.startsWith('Longsword') ? '09' : '13');

  const blackCarded = new Set<string>(); // registrations already black-carded (avoid 2nd → DQ)
  // A couple of pool matches end in a "double out": posting DOUBLE_CAP doubles
  // auto-completes the match as a 0–0 double loss (both fighters lose,
  // end_reason=max_doubles, no winner). This is the ONLY place that posts that
  // many doubles, and it is reachable for pool matches only (gated by
  // `allowDoubleOut`) — a null winner can't advance a bracket slot. Set to the
  // first 2 NON-scripted Longsword pool matches at play time (scripted matches are
  // forced shutout wins), so `doubleOuts > 0` always holds.
  let doubleOutMatchIds = new Set<string>();
  let played = 0;
  let exchangesPosted = 0;
  let cardsPosted = 0;
  let doubleOuts = 0;

  const playMatch = async (m: PwmMatch, idx: number, allowDoubleOut: boolean): Promise<void> => {
    const red = m.red_registration_id;
    const blue = m.blue_registration_id;
    if (!red || !blue || m.status === 'completed') return; // bye or already played

    // ── Scripted competitors sweep their Longsword pool (shutout → top-2 seed). ──
    const poolScriptedRegIds = [davidRegId, robinRegId].filter((x): x is string => Boolean(x));
    const scriptedSide: 'red' | 'blue' | null = poolScriptedRegIds.includes(red)
      ? 'red'
      : poolScriptedRegIds.includes(blue)
        ? 'blue'
        : null;
    if (scriptedSide) {
      matchBaseMs = baseMsOf(m.id, WS_DAYS[0]!, '09:00', idx * 90_000);
      await patch(`matches/${m.id}/status`, { data: { status: 'running' } });
      const wColor = scriptedSide;
      const lColor = scriptedSide === 'red' ? 'blue' : 'red';
      const wReg = scriptedSide === 'red' ? red : blue;
      let sq = 1;
      let sclk = 4_000 + Math.floor(Math.random() * 8_000);
      for (let i = 0; i < 8; i++) {
        // 8–0 shutout → 0 hits received, no doubles → maximal TF_v1 ratio.
        await exchange(m.id, {
          sequence: sq++,
          type: 'clean',
          firstStrikerColor: wColor,
          firstStrikeValue: 1,
          clockTimeMs: sclk,
        });
        sclk += gapMs();
        exchangesPosted++;
      }
      for (let a = 0; a < 2; a++) {
        // ≥2 afterblows, opponent-struck net-zero (1-1) → scripted timesHit stays 0.
        await exchange(m.id, {
          sequence: sq++,
          type: 'afterblow',
          firstStrikerColor: lColor,
          firstStrikeValue: 1,
          afterblowValue: 1,
          clockTimeMs: sclk,
        });
        sclk += gapMs();
        exchangesPosted++;
      }
      await patch(`matches/${m.id}/status`, {
        data: { status: 'completed', winnerRegistrationId: wReg },
      });
      played++;
      return;
    }

    // Pools were scheduled on day 1 → use their real scheduled_at as the clock base.
    matchBaseMs = baseMsOf(m.id, WS_DAYS[0]!, '09:00', idx * 90_000);
    await patch(`matches/${m.id}/status`, { data: { status: 'running' } });

    if (allowDoubleOut && doubleOutMatchIds.has(m.id)) {
      let dclock = 10_000;
      for (let d = 1; d <= DOUBLE_CAP; d++) {
        await exchange(m.id, { sequence: d, type: 'double', clockTimeMs: dclock });
        dclock += 20_000;
        exchangesPosted++;
      }
      doubleOuts++;
      played++;
      return; // the 4th double auto-completed the match as a 0–0 double loss
    }

    // Random winner side + margin so pools aren't a wall of identical 5–2s. The
    // lead always comes from CLEAN hits (loserPts < winnerPts), so it survives any
    // net-zero afterblow, and doubles/cards never favour the loser — the explicit
    // winnerRegistrationId therefore always agrees with the score.
    const winnerColor: 'red' | 'blue' = Math.random() < 0.5 ? 'red' : 'blue';
    const loserColor = winnerColor === 'red' ? 'blue' : 'red';
    const winnerReg = winnerColor === 'red' ? red : blue;
    const loserReg = winnerColor === 'red' ? blue : red;
    const winnerPts = 5 + Math.floor(Math.random() * 4); // 5..8
    const loserPts = Math.floor(Math.random() * winnerPts); // 0..winnerPts-1 (always behind)

    let seq = 1;
    let clock = 4_000 + Math.floor(Math.random() * 8_000); // start a few seconds in
    const hit = async (color: 'red' | 'blue', value: number) => {
      await exchange(m.id, {
        sequence: seq++,
        type: 'clean',
        firstStrikerColor: color,
        firstStrikeValue: value,
        clockTimeMs: clock,
      });
      clock += gapMs();
      exchangesPosted++;
    };
    // Interleave winner/loser clean hits, each a varied mix of 1s and 2s.
    let w = winnerPts;
    let l = loserPts;
    while (w > 0 || l > 0) {
      if (w > 0 && (l === 0 || Math.random() < 0.6)) {
        const v = w >= 2 && Math.random() < 0.6 ? 2 : 1;
        await hit(winnerColor, v);
        w -= v;
      } else {
        const v = l >= 2 && Math.random() < 0.3 ? 2 : 1;
        await hit(loserColor, v);
        l -= v;
      }
    }

    // Two afterblows every match: one 2-1 struck by the WINNER (deductive → winner
    // +1, stays clearly ahead and below the 10 cap) and one net-zero 1-1 (either
    // side). Keeps afterblows at ~15% of exchanges and exercises the 2-1 path.
    await exchange(m.id, {
      sequence: seq++,
      type: 'afterblow',
      firstStrikerColor: winnerColor,
      firstStrikeValue: 2,
      afterblowValue: 1,
      clockTimeMs: clock,
    });
    clock += gapMs();
    exchangesPosted++;
    await exchange(m.id, {
      sequence: seq++,
      type: 'afterblow',
      firstStrikerColor: Math.random() < 0.5 ? winnerColor : loserColor,
      firstStrikeValue: 1,
      afterblowValue: 1,
      clockTimeMs: clock,
    });
    clock += gapMs();
    exchangesPosted++;
    // ~25%: ONE extra "double" — a single double stays below DOUBLE_CAP so this
    // stays a normal win (never a double-out); it scores nobody but dents the
    // TF_v1 score ratio (it grows the denominator).
    if (Math.random() < 0.25) {
      await exchange(m.id, { sequence: seq++, type: 'double', clockTimeMs: clock });
      clock += gapMs();
      exchangesPosted++;
    }

    // Cards come from the ruleset's REAL entries (rulesetEntryId) — the API derives
    // the card from each entry's `sanctions` ladder by group occurrence. Each card
    // pauses the bout, advancing the match clock. First-occurrence yellow = 0 pts
    // (safe on either fighter); repeating ONE yellow→red entry on the LOSER escalates
    // to a red (−1 to the carded fighter → widens the winner's lead); a disqualifying
    // (black) entry on the loser is the rare, controlled, deterministic forfeit (never
    // a 2nd black for one fighter → DQ).
    let pseq = 1;
    const card = async (registrationId: string, entry: PenaltyEntry | null) => {
      if (!entry) return;
      clock += cardPauseMs();
      await penalty(m.id, {
        sequence: pseq++,
        registrationId,
        rulesetEntryId: entry.id,
        clockTimeMs: clock,
      });
      cardsPosted++;
    };
    if (idx % 41 === 0 && blackEntries.length && !blackCarded.has(loserReg)) {
      blackCarded.add(loserReg);
      await card(loserReg, pickEntry(blackEntries));
      played++;
      return; // forfeit auto-completed the match (winner = opponent)
    }
    if (Math.random() < 0.45) await card(loserReg, pickEntry(yellowEntries));
    if (Math.random() < 0.25) await card(winnerReg, pickEntry(yellowEntries));
    if (Math.random() < 0.22) {
      // Same yellow→red entry twice on the loser: 1st = yellow, 2nd = red (−1 loser).
      const e = pickEntry(escalatingEntries);
      await card(loserReg, e);
      await card(loserReg, e);
    }

    await patch(`matches/${m.id}/status`, {
      data: { status: 'completed', winnerRegistrationId: winnerReg },
    });
    played++;
  };

  // Load the generated schedule so each pool match's exchanges are timestamped at its
  // real scheduled_at (+ the match clock), not the test-run instant.
  await step('load schedule (anchor pool timestamps)', async () => {
    const rows = (await (await reqOk(await get(`events/${eventId}/schedule`))).json()) as Array<{
      id: string;
      scheduledAt: string | null;
    }>;
    for (const r of rows) if (r.scheduledAt) scheduledByMatchId.set(r.id, r.scheduledAt);
    return scheduledByMatchId.size;
  });

  // Staff the pools now they're scheduled (referees assigned before the pools are played).
  await fillReferees('pools');

  for (const tid of tournamentIds) {
    // Confine the 2 double-outs to the first tournament (1–2 total across the run).
    const allowDoubleOut = tid === tournamentIds[0];
    const pools = (await (
      await reqOk(await get(`tournaments/${tid}/pools-with-matches`))
    ).json()) as Array<{ matches?: PwmMatch[] }>;
    const matches = pools.flatMap((p) => p.matches ?? []);
    if (allowDoubleOut) {
      const scriptedRegIds = [davidRegId, robinRegId].filter((x): x is string => Boolean(x));
      doubleOutMatchIds = new Set(
        matches
          .filter(
            (m) =>
              m.red_registration_id &&
              m.blue_registration_id &&
              !scriptedRegIds.includes(m.red_registration_id) &&
              !scriptedRegIds.includes(m.blue_registration_id),
          )
          .slice(0, 2)
          .map((m) => m.id),
      );
    }
    let idx = 0;
    for (const m of matches) {
      try {
        await playMatch(m, idx, allowDoubleOut);
      } catch (e) {
        console.log(`    ✗ match ${m.id.slice(0, 8)}: ${(e as Error).message}`);
      }
      idx++;
    }
  }
  console.log(
    `  ✓ played ${played} pool matches (${exchangesPosted} exchanges, ${cardsPosted} cards, ${doubleOuts} double-outs)`,
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

  // ── On-read stats freshness + afterblow netting (regression guard for 0128) ────
  // The pool exchanges just scored must be reflected by the stats endpoints with
  // NO refresh call anywhere — proving fighter_exchange_stats is computed on-read
  // (the old materialized view went stale here). Both tournaments are deductive,
  // so we also assert the netting invariant: every point one fighter is credited
  // (given) is charged to their opponent (received), so the tournament-wide sums
  // must match — this exercises the own-delta/opponent-delta point formula.
  for (const tid of tournamentIds) {
    await step(`stats fresh ${tid.slice(0, 8)}`, async () => {
      const overview = (await (
        await reqOk(await get(`tournaments/${tid}/stats/overview`))
      ).json()) as {
        participantCount: number;
        exchangeCount: number;
        doublesCount: number;
      };
      const fighters = (await (
        await reqOk(await get(`tournaments/${tid}/stats/fighters`))
      ).json()) as Array<{
        pointsGiven: number;
        pointsReceived: number;
      }>;

      // Freshness: scored data is visible immediately, no refresh needed.
      expect(overview.exchangeCount).toBeGreaterThan(0);
      expect(overview.participantCount).toBeGreaterThan(0);
      expect(fighters.length).toBe(overview.participantCount);

      // Deductive sanity: netted points never go negative.
      for (const f of fighters) {
        expect(f.pointsGiven).toBeGreaterThanOrEqual(0);
        expect(f.pointsReceived).toBeGreaterThanOrEqual(0);
      }

      // Netting symmetry: Σ given === Σ received across the whole tournament.
      const given = fighters.reduce((s, f) => s + f.pointsGiven, 0);
      const received = fighters.reduce((s, f) => s + f.pointsReceived, 0);
      expect(given).toBe(received);

      console.log(
        `    ↳ ${tid.slice(0, 8)}: ${overview.participantCount} fighters, ` +
          `${overview.exchangeCount} exchanges, Σpts ${given} — fresh on-read`,
      );
      return given;
    });
  }

  // ── Play each tournament's bracket of 16 down to a champion ────────────────────
  // Completing the last pool match fire-and-forgets populate-bracket (silent
  // until the pool gate is met), so R1 may already be seeded — we call it
  // explicitly anyway to be deterministic. Bracket matches play exactly like
  // pool matches; completing one auto-advances the winner (and the semis losers
  // into the bronze match) via BracketAdvanceService, which is fire-and-forget,
  // so we re-read the bracket between rounds and poll each slot until both sides
  // resolve. Scores VARY (margins 1–5, a random winning side, the odd afterblow
  // / yellow card) so the bracket isn't a wall of identical 5–2s.
  const readBracket = async (tid: string) =>
    (await (await reqOk(await get(`tournaments/${tid}/bracket`))).json()) as {
      slots: Array<{
        id: string;
        round: number;
        position: number;
        status: string;
        matchId: string | null;
        redFighterName: string | null;
        blueFighterName: string | null;
        redRegistrationId: string | null;
        blueRegistrationId: string | null;
      }>;
    };
  type BracketSlot = Awaited<ReturnType<typeof readBracket>>['slots'][number];

  let bracketPlayed = 0;

  const playBracketMatch = async (
    s: BracketSlot,
    baseMs: number,
    forcedWinnerReg: string | null = null,
  ): Promise<{ winnerName: string | null }> => {
    const mid = s.matchId!;
    const red = s.redRegistrationId!;
    const blue = s.blueRegistrationId!;
    matchBaseMs = baseMs; // brackets are scheduled only after play → computed day-2 slot
    await patch(`matches/${mid}/status`, { data: { status: 'running' } });

    const winnerColor: 'red' | 'blue' =
      forcedWinnerReg === red
        ? 'red'
        : forcedWinnerReg === blue
          ? 'blue'
          : Math.random() < 0.5
            ? 'red'
            : 'blue';
    const loserColor = winnerColor === 'red' ? 'blue' : 'red';
    const winnerReg = winnerColor === 'red' ? red : blue;
    const loserReg = winnerColor === 'red' ? blue : red;
    const winnerName = winnerColor === 'red' ? s.redFighterName : s.blueFighterName;
    const winnerPts = 4 + Math.floor(Math.random() * 5); // 4..8
    const loserPts = Math.floor(Math.random() * winnerPts); // 0..winnerPts-1 (blowouts + nail-biters)

    let seq = 1;
    let clock = 4_000 + Math.floor(Math.random() * 8_000); // start a few seconds in
    const hit = async (color: 'red' | 'blue', value: number) => {
      await exchange(mid, {
        sequence: seq++,
        type: 'clean',
        firstStrikerColor: color,
        firstStrikeValue: value,
        clockTimeMs: clock,
      });
      clock += gapMs();
      exchangesPosted++;
    };
    let w = winnerPts;
    while (w > 0) {
      const v = w >= 2 && Math.random() < 0.7 ? 2 : 1;
      await hit(winnerColor, v);
      w -= v;
    }
    let l = loserPts;
    while (l > 0) {
      const v = l >= 2 && Math.random() < 0.4 ? 2 : 1;
      await hit(loserColor, v);
      l -= v;
    }
    // Two afterblows: one 2-1 struck by the winner (winner +1, stays ahead, below
    // the 10 cap) and one net-zero 1-1.
    await exchange(mid, {
      sequence: seq++,
      type: 'afterblow',
      firstStrikerColor: winnerColor,
      firstStrikeValue: 2,
      afterblowValue: 1,
      clockTimeMs: clock,
    });
    clock += gapMs();
    exchangesPosted++;
    await exchange(mid, {
      sequence: seq++,
      type: 'afterblow',
      firstStrikerColor: Math.random() < 0.5 ? winnerColor : loserColor,
      firstStrikeValue: 1,
      afterblowValue: 1,
      clockTimeMs: clock,
    });
    clock += gapMs();
    exchangesPosted++;
    // ~25%: ONE "double" exchange (scores nobody) — a single double stays below
    // DOUBLE_CAP, so a bracket match never double-outs and always resolves to a
    // winner that can advance.
    if (Math.random() < 0.25) {
      await exchange(mid, { sequence: seq++, type: 'double', clockTimeMs: clock });
      clock += gapMs();
      exchangesPosted++;
    }
    // Cards from the ruleset's REAL entries (rulesetEntryId). First-occurrence yellow
    // = 0 pts (either fighter); repeating ONE yellow→red entry on the LOSER escalates
    // to a red (−1 to the loser, never flips the winner). No black here — a bracket
    // match must resolve to a winner that can advance.
    let pseq = 1;
    const card = async (registrationId: string, entry: PenaltyEntry | null) => {
      if (!entry) return;
      clock += cardPauseMs();
      await penalty(mid, {
        sequence: pseq++,
        registrationId,
        rulesetEntryId: entry.id,
        clockTimeMs: clock,
      });
      cardsPosted++;
    };
    if (Math.random() < 0.35) await card(loserReg, pickEntry(yellowEntries));
    if (Math.random() < 0.2) await card(winnerReg, pickEntry(yellowEntries));
    if (Math.random() < 0.15) {
      const e = pickEntry(escalatingEntries);
      await card(loserReg, e);
      await card(loserReg, e);
    }

    await patch(`matches/${mid}/status`, {
      data: { status: 'completed', winnerRegistrationId: winnerReg },
    });
    return { winnerName };
  };

  const playBracket = async (tid: string, name: string): Promise<number> => {
    // Bracket is already populated + scheduled (above) — play it straight through.
    let bracket = await readBracket(tid);
    const finalRound = Math.max(...bracket.slots.map((s) => s.round));
    const rounds = [...new Set(bracket.slots.map((s) => s.round))]
      .filter((r) => r >= 1)
      .sort((a, b) => a - b);
    let played = 0;
    let champion: string | null = null;

    for (const round of rounds) {
      bracket = await readBracket(tid); // pick up winners auto-advanced from prior round
      const slots = bracket.slots
        .filter((s) => s.round === round)
        .sort((a, b) => a.position - b.position);
      for (const slot of slots) {
        // Auto-advance is fire-and-forget — poll until both sides + matchId resolve.
        let s = slot;
        for (
          let tries = 0;
          tries < 12 && (!s.matchId || !s.redRegistrationId || !s.blueRegistrationId);
          tries++
        ) {
          await new Promise((r) => setTimeout(r, 500));
          const fresh = await readBracket(tid);
          s = fresh.slots.find((x) => x.id === slot.id) ?? s;
        }
        if (!s.matchId || !s.redRegistrationId || !s.blueRegistrationId) continue; // bye / unresolved
        if (s.status === 'completed') continue;
        try {
          // Longsword scripting: David & Robin win the round-of-16 (round 1) and
          // lose the quarter-final (round 2) → eliminated at the QF. They're in
          // opposite halves, so no slot ever holds both.
          let forcedWinnerReg: string | null = null;
          if (name.startsWith('Longsword')) {
            const bracketScriptedRegIds = [davidRegId, robinRegId].filter((x): x is string =>
              Boolean(x),
            );
            const inSlot = bracketScriptedRegIds.find(
              (rid) => rid === s.redRegistrationId || rid === s.blueRegistrationId,
            );
            if (inSlot) {
              const opp =
                s.redRegistrationId === inSlot ? s.blueRegistrationId : s.redRegistrationId;
              if (round === 1) forcedWinnerReg = inSlot;
              else if (round === 2) forcedWinnerReg = opp;
            }
          }
          const { winnerName } = await playBracketMatch(
            s,
            baseMsOf(
              s.matchId,
              WS_DAYS[1]!,
              `${bracketStartHour(name)}:00`,
              ((round - 1) * 30 + (s.position - 1) * 5) * 60_000,
            ),
            forcedWinnerReg,
          );
          played++;
          if (round === finalRound && s.position === 1) champion = winnerName;
        } catch (e) {
          console.log(`    ✗ bracket ${name} R${round}P${s.position}: ${(e as Error).message}`);
        }
      }
    }
    console.log(
      `  ✓ ${name}: played ${played} bracket matches` +
        (champion ? ` — champion: ${champion}` : ''),
    );
    return played;
  };

  // ── Populate each bracket from the pool results (seeds R1 into pre-created rows) ─
  for (const t of [long, side].filter((x) => x.id)) {
    const name = t === long ? 'Longsword Open' : 'Sidesword Open';
    await step(`${name}: populate bracket R1`, async () =>
      reqOk(await post(`tournaments/${t.id}/populate-bracket`, { data: {} })),
    );
  }

  // ── Schedule each bracket on day 2 (dayIndex 1), BEFORE it's played ─────────────
  // generate-bracket already created every bracket match row (all rounds, null
  // fighters), so one day-2-scoped generate places the whole bracket across the 4
  // lices; advancement later only UPDATEs fighters into those rows, preserving the
  // scheduled_at set here. dayIndices:[1] leaves the day-1 pools + their pinning
  // untouched, and it's the only bracket generate, so nothing reshuffles.
  for (const t of [long, side].filter((x) => x.id)) {
    const name = t === long ? 'Longsword Open' : 'Sidesword Open';
    const startHour = bracketStartHour(name); // same hour the occurred_at anchor uses
    await step(`${name}: bracket block (day 2)`, async () =>
      reqOk(
        await post(`events/${eventId}/programme/blocks`, {
          data: {
            dayIndex: 1,
            blockType: 'competition',
            label: `${name} — Bracket`,
            startTime: `${startHour}:00`,
            endTime: `${Number(startHour) + 4}:00`,
            liceCount: liceIds.length,
            matchGapSeconds: 30,
            matchDurationMinutes: 5,
            minRestMinutes: 0,
            competitionId: t.id,
            competitionPhase: 'bracket',
          },
        }),
      ),
    );
  }
  const genB = (await step('schedule brackets on day 2', async () =>
    (
      await reqOk(await post(`events/${eventId}/programme/generate`, { data: { dayIndices: [1] } }))
    ).json(),
  )) as { matchesScheduled?: number } | null;
  console.log(`    ↳ bracket matchesScheduled: ${genB?.matchesScheduled}`);

  // Re-load the schedule so bracket exchanges anchor occurred_at to their real day-2
  // scheduled_at, then staff the bracket — its slots now carry time windows.
  await step('load schedule (anchor bracket timestamps)', async () => {
    const rows = (await (await reqOk(await get(`events/${eventId}/schedule`))).json()) as Array<{
      id: string;
      scheduledAt: string | null;
    }>;
    for (const r of rows) if (r.scheduledAt) scheduledByMatchId.set(r.id, r.scheduledAt);
    return scheduledByMatchId.size;
  });
  await fillReferees('bracket');

  // ── Play each bracket down to a champion (occurred_at = real scheduled_at + clock) ─
  for (const t of [long, side].filter((x) => x.id)) {
    const name = t === long ? 'Longsword Open' : 'Sidesword Open';
    bracketPlayed += await playBracket(t.id, name);
  }
  console.log(
    `  ✓ played ${bracketPlayed} bracket matches across ${tournamentIds.length} tournaments`,
  );

  // ── Workshop venue + area, a midday break, then 6 scheduled workshops ───────────
  const venue = await step('create workshop venue', async () =>
    findOrCreateVenue({
      name: 'Gymnase des Cerisiers',
      address: '4 Rue Jean Rigaud, 69130 Écully',
      hostsWorkshop: true,
      hostsTournament: false,
    }),
  );
  const venueId = venue?.id as string | undefined;
  const areaIds: string[] = [];
  if (venueId) {
    for (let i = 1; i <= 1; i++) {
      const a = await findOrCreateArea(venueId, { name: `Area ${i}`, sortOrder: i });
      if (a) areaIds.push(a.id);
    }
  }

  // Midday break (12:00–14:00) on each workshop day. A workshop_break is a
  // first-class obstacle on the workshop board (separate from event programme
  // blocks); HH:MM is interpreted in the event timezone, scoped per dayIndex.
  for (let d = 0; d < WS_DAYS.length; d++) {
    await step(`workshop break day ${d + 1}`, async () =>
      reqOk(
        await post(`events/${eventId}/workshop-breaks`, {
          data: {
            dayIndex: d,
            startTime: '12:00',
            endTime: '14:00',
            label: 'Pause déjeuner',
            color: '#94a3b8',
          },
        }),
      ),
    );
  }
  console.log(`  ✓ workshop venue + ${areaIds.length} areas`);

  let wMade = 0;
  const createdWorkshopIds: string[] = [];
  for (let i = 0; i < 6; i++) {
    const instructor = instructors[i % Math.max(instructors.length, 1)];
    const ok = await step(`workshop ${i + 1}`, async () => {
      const res = await reqOk(
        await post(`events/${eventId}/workshops`, {
          data: {
            slug: `demo-ws-${tok}-${i}`,
            title: `Demo Workshop ${i + 1}`,
            durationMinutes: WS_DURATION_MIN,
            level: WS_LEVELS[i % WS_LEVELS.length],
            // Workshops now carry a real catalog-validated weapon (mig 0130 + the
            // shared weapon_catalog); WS_TOPICS are all active catalog names.
            weapon: WS_TOPICS[i % WS_TOPICS.length],
            category: WS_CATEGORIES[i % WS_CATEGORIES.length],
            descriptionMd:
              `A hands-on ${WS_TOPICS[i % WS_TOPICS.length]} workshop for ` +
              `${WS_LEVELS[i % WS_LEVELS.length]} practitioners.\n\n` +
              'We will cover footwork, core guards and a few signature techniques, ' +
              'then drill them in pairs. Bring your own protective gear; loaner ' +
              'equipment is limited.',
            capacity: 12 + i * 2,
            color: COLORS[i % COLORS.length],
            venueId,
          },
        }),
      );
      const workshopId = ((await res.json()) as { id: string }).id;
      createdWorkshopIds.push(workshopId);
      if (instructor) {
        await post(`events/${eventId}/instructors/${instructor.id}`);
        await post(`workshops/${workshopId}/instructors`, {
          data: { globalPersonId: refId(instructor) },
        });
      }
      // Spread the 6 workshops evenly: alternate Sat/Sun (3 each) and step through
      // the 2h day slots, all in the single area and clear of the 12:00–14:00
      // break. Times are built in the event tz so they align with the break.
      const day = WS_DAYS[i % 2];
      const startHhmm = WS_START_HHMM[Math.floor(i / 2)];
      const endHhmm = `${String(Number(startHhmm.slice(0, 2)) + WS_DURATION_MIN / 60).padStart(2, '0')}:00`;
      await post(`workshops/${workshopId}/sessions`, {
        data: {
          startTime: zonedToUtcIso(day, startHhmm, EVENT_TZ),
          endTime: zonedToUtcIso(day, endHhmm, EVENT_TZ),
          venueId,
          areaId: areaIds.length ? areaIds[0] : undefined,
        },
      });
      await patch(`workshops/${workshopId}`, { data: { status: 'published' } });
      return true;
    });
    if (ok) wMade++;
  }
  console.log(`  ✓ ${wMade}/6 workshops published`);

  // ── Extra instructors: David, Robin, Anthony (all also fighters / referees). ────
  await step('instructors: David, Robin, Anthony', async () => {
    const extraInstructors = [david, robin, anthony].filter((p): p is Person => p !== null);
    for (let i = 0; i < extraInstructors.length; i++) {
      const p = extraInstructors[i];
      await post(`events/${eventId}/instructors/${p.id}`);
      const ws = createdWorkshopIds[i % Math.max(createdWorkshopIds.length, 1)];
      if (ws) await post(`workshops/${ws}/instructors`, { data: { globalPersonId: refId(p) } });
    }
    console.log(
      `    ↳ tagged ${extraInstructors.map((p) => p.familyName).join(', ')} as instructors`,
    );
    return true;
  });

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
      `        workshops:   ${baseURL}/org/${orgSlug}/events/${eventId}/workshops\n` +
      `        public slug: ${eventSlugSet ?? '(unchanged)'}`,
  );

  expect(allPoolIds.length).toBeGreaterThan(0);
  expect(played).toBeGreaterThan(0);
  expect(bracketPlayed).toBeGreaterThan(0);
  expect(doubleOuts).toBeGreaterThan(0);
});
