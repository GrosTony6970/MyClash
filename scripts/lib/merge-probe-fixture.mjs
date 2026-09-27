/**
 * The seeded profiles, the calls and the reads of `scripts/db-merge-probe.mjs` (ruling 133).
 *
 * Everything here runs inside the probe's one transaction, which is always rolled back. A
 * scenario runs as the service role (the API's client) in its own savepoint, rolled back too;
 * a refusal is caught in a nested savepoint so the scenario goes on.
 */

export const ROLLBACK = new Error('rollback');

export async function rolledBack(run) {
  try {
    await run();
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}

// ── Checks ──────────────────────────────────────────────────────────────────
const failures = [];
let checks = 0;

export function check(label, actual, expected) {
  checks += 1;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
}

export const probeResult = () => ({ checks, failures });

// ── Seed ────────────────────────────────────────────────────────────────────
export const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const U = { actor: id(1), alice: id(2), bob: id(3), lea: id(4), max: id(5) };
export const P = { source: id(11), target: id(12), third: id(13) };
const E = id(21);
export const W = { shared: id(31), own: id(32) };
export const I = { sourceShared: id(41), targetShared: id(42), sourceOwn: id(43) };
export const PERSON = { s1: id(51), s2: id(52), t1: id(53) };
export const MANY = 1500;

/**
 * Lea's two profiles. The merged-away one (source) owns the account, hides her Workshops and
 * accepts followers; the survivor (target) has no owner, refuses followers, and a few blanks —
 * NULL and '' both — for the source to fill. Both teach the "Cutting" Workshop.
 */
export async function seed(tx) {
  await tx`INSERT INTO auth.users (id) SELECT unnest(${Object.values(U)}::uuid[])`;
  await tx`INSERT INTO auth.users (id)
    SELECT ('00000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid FROM generate_series(1, ${MANY}) g`;
  await tx`INSERT INTO organizations (id, slug, name) VALUES (${id(20)}, 'merge-probe-club', 'Merge Probe Club')`;
  await tx`INSERT INTO events (id, organization_id, slug, name, start_date, end_date)
    VALUES (${E}, ${id(20)}, 'merge-probe', 'Merge Probe', '2026-09-12', '2026-09-13')`;
  await tx`INSERT INTO global_persons
      (id, slug, display_name, given_name, family_name, photo_url, bio, country_code,
       hema_ratings_id, gender_category, hide_workshops_publicly, allow_being_followed,
       claimed_by_user_id)
    VALUES
      (${P.source}, 'lea-a', 'Lea A', 'Lea', 'A', 'a.jpg', '', 'FR', '123', 'open', true, true, ${U.lea}),
      (${P.target}, 'lea-b', 'Lea B', 'Lea', 'B', NULL, 'b bio', '', '', NULL, false, false, NULL),
      (${P.third}, 'lea-c', 'Lea C', 'Lea', 'C', NULL, NULL, NULL, NULL, NULL, false, true, NULL)`;
  await tx`INSERT INTO persons (id, event_id, given_name, family_name, global_person_id) VALUES
    (${PERSON.s1}, ${E}, 'Lea', 'A', ${P.source}),
    (${PERSON.s2}, ${E}, 'Lea', 'A', ${P.source}),
    (${PERSON.t1}, ${E}, 'Lea', 'B', ${P.target})`;
  await tx`INSERT INTO workshops (id, event_id, slug, title) VALUES
    (${W.shared}, ${E}, 'cutting', 'Cutting'), (${W.own}, ${E}, 'binding', 'Binding')`;
  await tx`INSERT INTO workshop_instructors (id, workshop_id, global_person_id, display_name) VALUES
    (${I.sourceShared}, ${W.shared}, ${P.source}, 'Lea A'),
    (${I.targetShared}, ${W.shared}, ${P.target}, 'Lea B'),
    (${I.sourceOwn}, ${W.own}, ${P.source}, 'Lea A')`;
  await tx`INSERT INTO directory_follows (follower_user_id, followed_global_person_id) VALUES
    (${U.alice}, ${P.source}), (${U.bob}, ${P.source}), (${U.bob}, ${P.target})`;
}

// ── Calls ───────────────────────────────────────────────────────────────────
export const snapshot = (profile) => ({ id: profile, display_name: `snapshot of ${profile}` });

/** Runs `run` as the service role (the API's client) in a savepoint that is always rolled back. */
export async function scenario(tx, run) {
  await rolledBack(() =>
    tx.savepoint(async (sp) => {
      await sp`SET LOCAL ROLE service_role`;
      await run(sp);
      throw ROLLBACK;
    }),
  );
}

export const merge = (q, source, target, reason = 'duplicate') =>
  q`SELECT public.merge_fighters(${source}, ${target}, ${U.actor}, ${reason},
      ${JSON.stringify(snapshot(source))}::text::jsonb,
      ${JSON.stringify(snapshot(target))}::text::jsonb) AS moved`.then((rows) => rows[0].moved);

export const revert = (q, auditId) => q`SELECT public.revert_fighter_merge(${auditId}, ${U.actor})`;

/** The error a call raises in its own savepoint (so the scenario goes on), or null. */
export async function refusal(q, call) {
  let raised = null;
  await rolledBack(() =>
    q.savepoint(async (sp) => {
      try {
        await call(sp);
      } catch (error) {
        raised = { code: error.code, message: error.message };
      }
      throw ROLLBACK;
    }),
  );
  return raised;
}

export const words = (code, message) => ({ code, message });

// ── Reads ───────────────────────────────────────────────────────────────────
export const lastMerge = (q, source) =>
  q`SELECT id, payload_json FROM audit_log WHERE action = 'fighter.merge' AND entity_id = ${source}
      ORDER BY created_at DESC, id DESC LIMIT 1`.then((rows) => rows[0]);

export const followedBy = (q, user) =>
  q`SELECT followed_global_person_id AS p FROM directory_follows WHERE follower_user_id = ${user}
      ORDER BY p`.then((rows) => rows.map((row) => row.p));

export const onProfile = async (q, table, rowId) =>
  (await q`SELECT global_person_id AS p FROM ${q(table)} WHERE id = ${rowId}`)[0]?.p;

export const profile = (q, profileId) =>
  q`SELECT photo_url, bio, country_code, hema_ratings_id, gender_category,
        hide_workshops_publicly AS hide, allow_being_followed AS allow,
        claimed_by_user_id AS claim, merged_into_id AS merged_into,
        merged_at IS NOT NULL AS merged, deleted_at IS NOT NULL AS deleted,
        merge_reverted_at IS NOT NULL AS reverted
      FROM global_persons WHERE id = ${profileId}`.then((rows) => rows[0]);
