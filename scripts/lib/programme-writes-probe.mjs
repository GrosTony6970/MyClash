/**
 * Check 12 of the RLS probe (`scripts/db-rls-probe.mjs`): the programme moves only bouts that exist
 * (migration 0231).
 *
 * On the running database: Generate's write places a bout on its Lice at its time and clears its
 * typed override; a cascade's write retimes it, and not once it has started; a row whose bout does not exist moves nothing and
 * makes no bout; each answers how many bouts it moved; a Lice of another Event is still refused
 * (0197) and nothing moves; neither public role may call either function, the service role may.
 * Every case runs in a savepoint always rolled back.
 */

import { attempt } from './ruleset-pair-probe.mjs';

// The published Event's bout of `rls-probe-seed.sql`, its own Lice and the draft Event's Lice.
const BOUT = 'dddddddd-0000-4000-8000-00000000000a';
const OWN_LICE = '11ce0000-0000-4000-8000-00000000000a';
const OTHER_EVENT_LICE = '11ce0000-0000-4000-8000-00000000000b';
const NO_BOUT = 'dddddddd-0000-4000-8000-0000000000ff';
const AT = '2026-10-01T10:15:00.000Z';
const LATER = '2026-10-01T11:45:00.000Z';

const ROLLBACK = new Error('rollback');

/** `body(sp)` in a savepoint always rolled back: each case starts from the seed. */
async function isolated(tx, body) {
  try {
    await tx.savepoint(async (sp) => {
      await body(sp);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}

const boutOf = async (sp, id) =>
  (
    await sp`SELECT scheduled_at, lice_id, planned_duration_override_minutes
             FROM matches WHERE id = ${id}`
  )[0];

const boutCount = async (sp) => Number((await sp`SELECT count(*) AS n FROM matches`)[0].n);

async function placeFailures(tx, failures) {
  await isolated(tx, async (sp) => {
    await sp`UPDATE matches SET planned_duration_override_minutes = 9 WHERE id = ${BOUT}`;
    const before = await boutCount(sp);
    const rows = [
      { id: BOUT, scheduled_at: AT, lice_id: OWN_LICE },
      { id: NO_BOUT, scheduled_at: AT, lice_id: OWN_LICE },
    ];
    const [{ moved }] = await sp`SELECT public.programme_place_bouts(${sp.json(rows)}) AS moved`;
    if (moved !== 1) failures.push(`Generate's write answered ${moved} bouts moved, not 1`);
    if ((await boutCount(sp)) !== before) failures.push("Generate's write made a bout");
    const bout = await boutOf(sp, BOUT);
    if (bout.scheduled_at?.toISOString() !== AT || bout.lice_id !== OWN_LICE)
      failures.push("Generate's write did not place the bout on its Lice at its time");
    if (bout.planned_duration_override_minutes !== null)
      failures.push("Generate's write kept the bout's typed override");
  });
}

async function retimeFailures(tx, failures) {
  await isolated(tx, async (sp) => {
    const before = await boutCount(sp);
    const rows = [
      { id: BOUT, scheduled_at: LATER },
      { id: NO_BOUT, scheduled_at: LATER },
    ];
    const [{ moved }] = await sp`SELECT public.programme_retime_bouts(${sp.json(rows)}) AS moved`;
    if (moved !== 1) failures.push(`a cascade's write answered ${moved} bouts moved, not 1`);
    if ((await boutCount(sp)) !== before) failures.push("a cascade's write made a bout");
    if ((await boutOf(sp, BOUT)).scheduled_at?.toISOString() !== LATER)
      failures.push("a cascade's write did not retime the bout");
  });
  // A bout that started since the cascade's read keeps the time it was given.
  await isolated(tx, async (sp) => {
    await sp`UPDATE matches SET status = 'running', scheduled_at = ${AT} WHERE id = ${BOUT}`;
    const rows = [{ id: BOUT, scheduled_at: LATER }];
    const [{ moved }] = await sp`SELECT public.programme_retime_bouts(${sp.json(rows)}) AS moved`;
    if (moved !== 0 || (await boutOf(sp, BOUT)).scheduled_at?.toISOString() !== AT)
      failures.push("a cascade's write retimed a bout that had started");
  });
}

async function otherEventLiceFailures(tx, failures) {
  await isolated(tx, async (sp) => {
    const before = await boutOf(sp, BOUT);
    let refused = null;
    await isolated(sp, (inner) =>
      inner`SELECT public.programme_place_bouts(${inner.json([
        { id: BOUT, scheduled_at: AT, lice_id: OTHER_EVENT_LICE },
      ])})`.catch((error) => {
        refused = error;
      }),
    );
    if (refused?.code !== '23514')
      failures.push(
        `Generate's write placed a bout on another Event's Lice (${refused?.message ?? 'no error'})`,
      );
    if ((await boutOf(sp, BOUT)).lice_id !== before.lice_id)
      failures.push("a refused Generate's write moved the bout");
  });
}

async function grantFailures(tx, failures) {
  const rows = [{ id: BOUT, scheduled_at: AT }];
  const calls = {
    programme_place_bouts: (sp) => sp`SELECT public.programme_place_bouts(${sp.json(rows)})`,
    programme_retime_bouts: (sp) => sp`SELECT public.programme_retime_bouts(${sp.json(rows)})`,
  };
  for (const [fn, byName] of Object.entries(calls)) {
    for (const role of ['anon', 'authenticated']) {
      const error = await attempt(tx, role, byName);
      if (error?.code !== '42501')
        failures.push(`${role} called ${fn} (${error?.message ?? 'no error'})`);
    }
    const served = await attempt(tx, 'service_role', byName);
    if (served) failures.push(`the service role could not call ${fn} (${served.message})`);
  }
}

/** What is wrong, as sentences; none when all is right. */
export async function programmeWritesFailures(tx) {
  const failures = [];
  await placeFailures(tx, failures);
  await retimeFailures(tx, failures);
  await otherEventLiceFailures(tx, failures);
  await grantFailures(tx, failures);
  return failures;
}
