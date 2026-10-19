/**
 * The seed's rows and the helpers the checks of a Match's copy of its rules share (check 11 of the
 * RLS probe: `match-rules-probe.mjs`, `match-rules-only-copy-probe.mjs`).
 */

// The published Event and Tournament of `rls-probe-seed.sql`, its phase and bout, and the draft
// Tournament's (same Event) phase; the Club and its own card and scoring rulesets.
export const OPEN = 'eeeeeeee-0000-4000-8000-00000000000a';
export const TOURNAMENT = '77777777-0000-4000-8000-00000000000a';
export const OTHER_TOURNAMENT = '77777777-0000-4000-8000-00000000000c';
export const PHASE = '99999999-0000-4000-8000-00000000000a';
export const BOUT = 'dddddddd-0000-4000-8000-00000000000a';
// The copy the seed gives the published Tournament's bout (every bout holds one, 0232).
export const SEED_COPY = 'ad000000-0000-4000-8000-00000000000a';
export const OTHER_BOUT = 'dddddddd-0000-4000-8000-00000000000c';
export const CLUB_CARDS = 'fe000000-0000-4000-8000-00000000000a';
export const CLUB_SCORING = 'rls-probe-club-scoring';
// A second bout of the published Tournament, and another club with a shared card ruleset.
export const SECOND = 'dddddddd-0000-4000-8000-0000000000a2';
export const OTHER_CLUB = 'aaaaaaaa-0000-4000-8000-0000000000c2';
export const OTHER_CARDS = 'fe000000-0000-4000-8000-0000000000c2';

const ROLLBACK = new Error('rollback');

/** `body(sp)` in a savepoint always rolled back: each case starts from the seed. */
export async function isolated(tx, body) {
  try {
    await tx.savepoint(async (sp) => {
      await body(sp);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}

/** `statement` in its own savepoint; its error, or null. */
export async function errorOf(sp, statement) {
  let failure = null;
  await isolated(sp, (inner) =>
    statement(inner).catch((error) => {
      failure = error;
    }),
  );
  return failure;
}

export const stamp = async (sp, tournament = TOURNAMENT) =>
  (await sp`SELECT public.stamp_match_rules(${tournament}) AS id`)[0].id;

export const boutOf = async (sp, id) =>
  (await sp`SELECT match_rules_id, earlier_rules_ids FROM matches WHERE id = ${id}`)[0];

export const copyOf = async (sp, id) => (await sp`SELECT * FROM match_rules WHERE id = ${id}`)[0];

export const same = (got, want) => JSON.stringify(got) === JSON.stringify(want);

export const setCap = (sp, cap) =>
  sp`UPDATE tournaments SET ruleset_config = ${sp.json({ matchFormat: { pointCap: cap } })}
     WHERE id = ${TOURNAMENT}`;
