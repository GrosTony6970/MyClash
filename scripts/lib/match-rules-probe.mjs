/**
 * Check 11 of the RLS probe (`scripts/db-rls-probe.mjs`): a Match carries its own copy of its rules
 * (migration 0229, the foundation slice; rulings "What a bout keeps", "A direct bout write").
 *
 * On the running database: every Match holds a copy and its row no engine columns (0232); the stamp
 * points the Matches not started at the Tournament's copy of now, keeps the one each held as
 * earlier (once), leaves a started Match on its own, writes no Match it does not move
 * (one that holds the copy, one of another Tournament); the card pin resolves Tournament,
 * Event, built-in; a card ruleset a bout's copy pins, now or (not started) before, is held (0230), one only a
 * dead copy pins is not, and so is a club ruleset version a bout's copy names (ruling M, 0232); a copy
 * never changes but for its pin set NULL by a delete (a card ruleset's, an organisation's); an Event
 * delete still cascades; a Match takes only a copy of its own Tournament, whoever writes it; and
 * neither public role may call the functions. Every case runs in a savepoint always rolled back.
 */

import {
  BOUT,
  CLUB_CARDS,
  CLUB_SCORING,
  OPEN,
  OTHER_BOUT,
  OTHER_CARDS,
  OTHER_CLUB,
  OTHER_TOURNAMENT,
  PHASE,
  SECOND,
  SEED_COPY,
  TOURNAMENT,
  boutOf,
  copyOf,
  errorOf,
  isolated,
  same,
  setCap,
  stamp,
} from './match-rules-probe-kit.mjs';
import { heldPairFailures, onlyCopyFailures } from './match-rules-only-copy-probe.mjs';
import { attempt } from './ruleset-pair-probe.mjs';

async function stampFailures(tx, failures) {
  await isolated(tx, async (sp) => {
    // The second bout of the Tournament, on the seed's copy as the first is.
    await sp`INSERT INTO matches (id, phase_id, match_rules_id) VALUES (${SECOND}, ${PHASE}, ${SEED_COPY})`;
    const first = await stamp(sp);
    if ((await stamp(sp)) !== first)
      failures.push('a second stamp with nothing changed made a new copy');
    const fresh = await boutOf(sp, BOUT);
    if (fresh.match_rules_id !== first || !same(fresh.earlier_rules_ids, [SEED_COPY]))
      failures.push(`a first stamp kept ${JSON.stringify(fresh)}, not [${SEED_COPY}] as earlier`);

    // The second bout starts; the cap moves twice; it comes back to "not started" between.
    await sp`UPDATE matches SET status = 'running' WHERE id = ${SECOND}`;
    await setCap(sp, 7);
    const second = await stamp(sp);
    const running = await boutOf(sp, SECOND);
    if (running.match_rules_id !== first) failures.push('the stamp moved a started bout');
    await sp`UPDATE matches SET status = 'scheduled' WHERE id = ${SECOND}`;
    await setCap(sp, 9);
    const third = await stamp(sp);
    await stamp(sp);
    const a = await boutOf(sp, BOUT);
    const b = await boutOf(sp, SECOND);
    if (a.match_rules_id !== third || !same(a.earlier_rules_ids, [SEED_COPY, first, second]))
      failures.push(
        `the first bout holds ${JSON.stringify(a)}, not ${third} after [seed, ${first}, ${second}]`,
      );
    if (b.match_rules_id !== third || !same(b.earlier_rules_ids, [SEED_COPY, first]))
      failures.push(
        `the second bout holds ${JSON.stringify(b)}, not ${third} after [seed, ${first}]`,
      );
    const copy = await copyOf(sp, third);
    if (copy.ruleset_config?.matchFormat?.pointCap !== 9)
      failures.push(`the copy of now holds ${JSON.stringify(copy.ruleset_config)}`);

    // Back to a copy it held, then on again: each copy is held once.
    await setCap(sp, 7);
    await stamp(sp);
    await setCap(sp, 9);
    await stamp(sp);
    const back = await boutOf(sp, BOUT);
    if (!same(back.earlier_rules_ids, [SEED_COPY, first, second, third]))
      failures.push(
        `a bout back on copies it held holds ${JSON.stringify(back.earlier_rules_ids)}`,
      );
  });
}

/**
 * A stamp writes only the bouts it moves: a bout that holds the copy already is not written again
 * (each write is a change notice, and a new `updated_at` a league reads as "results changed"), and
 * another Tournament's bouts are not written at all. A written row has a new `ctid`.
 */
async function quietStampFailures(tx, failures) {
  await isolated(tx, async (sp) => {
    const placeOf = async (id) =>
      (await sp`SELECT ctid::text AS at FROM matches WHERE id = ${id}`)[0].at;
    await stamp(sp, OTHER_TOURNAMENT);
    await stamp(sp);
    const [held, elsewhere] = [await placeOf(BOUT), await placeOf(OTHER_BOUT)];
    await stamp(sp);
    if ((await placeOf(BOUT)) !== held) failures.push('a stamp rewrote a bout that held its copy');
    await setCap(sp, 7);
    await stamp(sp);
    if ((await placeOf(OTHER_BOUT)) !== elsewhere)
      failures.push('a stamp wrote a bout of another Tournament');
  });
}

/** Of the scoring settings, a copy keeps the two that score (ruling "Buttons"), nothing else. */
async function scoringKeysFailures(tx, failures) {
  await isolated(tx, async (sp) => {
    const scoring = {
      afterblowMode: 'deductive',
      buttons: [{ value: 3 }],
      colours: { red: '#f00' },
    };
    await sp`UPDATE tournaments SET scoring_config_json = ${sp.json(scoring)} WHERE id = ${TOURNAMENT}`;
    const { scoring_config_json: kept } = await copyOf(sp, await stamp(sp));
    const keys = Object.keys(kept).sort().join(',');
    if (keys !== 'afterblowMode,buttons' || kept.buttons?.[0]?.value !== 3)
      failures.push(`a copy kept ${JSON.stringify(kept)} of the scoring settings`);
  });
}

/** The card pin, as `getEffectiveRulesetForTournament` resolves it: Tournament, Event, built-in. */
async function cardPinFailures(tx, failures) {
  await isolated(tx, async (sp) => {
    const [builtIn] = await sp`
      SELECT id, version FROM penalty_rulesets
      WHERE built_in AND owner_organization_id IS NULL LIMIT 1`;
    const pinOf = async () => {
      const copy = await copyOf(sp, await stamp(sp));
      return [copy.penalty_ruleset_id, copy.penalty_ruleset_version];
    };
    // One version for the three pins: only the pinned ruleset tells their copies apart.
    const version = builtIn.version;
    const cases = [
      ['the built-in', async () => {}, [builtIn.id, version]],
      [
        "the Event's",
        () => sp`UPDATE events SET penalty_ruleset_id = ${CLUB_CARDS},
                 penalty_ruleset_version = ${version} WHERE id = ${OPEN}`,
        [CLUB_CARDS, version],
      ],
      [
        "the Tournament's",
        () => sp`UPDATE tournaments SET penalty_ruleset_id = ${OTHER_CARDS},
                 penalty_ruleset_version = ${version} WHERE id = ${TOURNAMENT}`,
        [OTHER_CARDS, version],
      ],
    ];
    await sp`INSERT INTO organizations (id, slug, name) VALUES (${OTHER_CLUB}, 'rls-probe-c2', 'C2')`;
    await sp`INSERT INTO penalty_rulesets (id, code, version, name, owner_organization_id, public_visibility)
             VALUES (${OTHER_CARDS}, 'rls-probe-c2', '2', 'C2', ${OTHER_CLUB}, true)`;
    for (const [whose, pin, want] of cases) {
      await pin();
      const got = await pinOf();
      if (JSON.stringify(got) !== JSON.stringify(want))
        failures.push(
          `a copy took ${JSON.stringify(got)} as its card pin, not ${whose} ${JSON.stringify(want)}`,
        );
    }
  });
}

/** A real change of a copy's settings: the seeded Tournament's are `{}`, so `{}` would be none. */
const CHANGED = { matchFormat: { pointCap: 99 } };

async function immutableFailures(tx, failures) {
  await isolated(tx, async (sp) => {
    const id = await stamp(sp);
    const change = await errorOf(
      sp,
      (inner) =>
        inner`UPDATE match_rules SET ruleset_config = ${inner.json(CHANGED)} WHERE id = ${id}`,
    );
    if (change?.code !== '23514')
      failures.push(`a copy was changed (${change?.message ?? 'no error'})`);
  });
  for (const [what, remove] of [
    ['its card ruleset', (sp) => sp`DELETE FROM penalty_rulesets WHERE id = ${OTHER_CARDS}`],
    ['its organisation', (sp) => sp`DELETE FROM organizations WHERE id = ${OTHER_CLUB}`],
  ]) {
    await isolated(tx, async (sp) => {
      await sp`INSERT INTO organizations (id, slug, name) VALUES (${OTHER_CLUB}, 'rls-probe-c2', 'C2')`;
      await sp`INSERT INTO penalty_rulesets (id, code, version, name, owner_organization_id, public_visibility)
               VALUES (${OTHER_CARDS}, 'rls-probe-c2', '2', 'C2', ${OTHER_CLUB}, true)`;
      await sp`UPDATE tournaments SET penalty_ruleset_id = ${OTHER_CARDS} WHERE id = ${TOURNAMENT}`;
      const id = await stamp(sp);
      const before = await copyOf(sp, id);
      const error = await errorOf(sp, async (inner) => {
        await remove(inner);
        const after = await copyOf(inner, id);
        if (after.penalty_ruleset_id !== null || after.digest !== before.digest)
          failures.push(`deleting ${what} left the copy ${JSON.stringify(after)}`);
        // With its pin gone, the copy is still not to be changed.
        const change = await errorOf(
          inner,
          (deeper) =>
            deeper`UPDATE match_rules SET ruleset_config = ${deeper.json(CHANGED)} WHERE id = ${id}`,
        );
        if (change?.code !== '23514')
          failures.push(`a copy with no pin was changed (${change?.message ?? 'no error'})`);
      });
      if (error) failures.push(`deleting ${what} was refused (${error.message})`);
    });
  }
  // An Event delete cascades to its Tournaments, their phases, bouts and copies in one statement:
  // the bouts' pointer (NO ACTION) is checked at its end, when both are gone. Its registrations go
  // first: `registrations.person_id` is RESTRICT against the Event's persons, copies or none.
  await isolated(tx, async (sp) => {
    await stamp(sp);
    await sp`DELETE FROM registrations r USING tournaments t
             WHERE r.tournament_id = t.id AND t.event_id = ${OPEN}`;
    const error = await errorOf(sp, (inner) => inner`DELETE FROM events WHERE id = ${OPEN}`);
    if (error) failures.push(`an Event whose bouts hold copies was not deleted (${error.message})`);
  });
}

/**
 * A card ruleset a bout holds, by its copy or, while it is not started, by one it held before, is
 * held (0230): the edit guard keeps it as it is. A copy no bout holds does not count.
 */
async function heldCardFailures(tx, failures) {
  await isolated(tx, async (sp) => {
    const heldNow = async () =>
      (await sp`SELECT public.card_ruleset_held_by_a_bout(${OTHER_CARDS}) AS held`)[0].held;
    await sp`INSERT INTO organizations (id, slug, name) VALUES (${OTHER_CLUB}, 'rls-probe-c2', 'C2')`;
    await sp`INSERT INTO penalty_rulesets (id, code, version, name, owner_organization_id, public_visibility)
             VALUES (${OTHER_CARDS}, 'rls-probe-c2', '2', 'C2', ${OTHER_CLUB}, true)`;
    await sp`UPDATE tournaments SET penalty_ruleset_id = ${OTHER_CARDS} WHERE id = ${TOURNAMENT}`;
    // A copy that pins it, which no bout points at.
    await sp`SELECT public.build_match_rules(${TOURNAMENT}, 'TF_v1', '1.0.0', 'no-bout')`;
    if (await heldNow()) failures.push('a card ruleset only a copy no bout holds pins was held');
    await stamp(sp);
    if (!(await heldNow())) failures.push("a card ruleset a bout's copy pins was not held");
    await sp`UPDATE tournaments SET penalty_ruleset_id = NULL WHERE id = ${TOURNAMENT}`;
    await stamp(sp);
    if (!(await heldNow()))
      failures.push('a card ruleset a not-started bout held before was not held');
    // Started on its copy of now, the bout holds its earlier copies no more.
    await sp`UPDATE matches SET status = 'running' WHERE id = ${BOUT}`;
    if (await heldNow()) failures.push('a card ruleset a started bout held before was held');
  });
}

async function ownTournamentFailures(tx, failures) {
  await isolated(tx, async (sp) => {
    const other = await stamp(sp, OTHER_TOURNAMENT);
    const own = await stamp(sp);
    const foreign = await errorOf(
      sp,
      (inner) => inner`UPDATE matches SET match_rules_id = ${other} WHERE id = ${BOUT}`,
    );
    if (foreign?.code !== '23514')
      failures.push(`a bout took another Tournament's copy (${foreign?.message ?? 'no error'})`);
    const mine = await errorOf(
      sp,
      (inner) => inner`UPDATE matches SET match_rules_id = ${own} WHERE id = ${BOUT}`,
    );
    if (mine) failures.push(`a bout was refused its own Tournament's copy (${mine.message})`);
  });
}

async function grantFailures(tx, failures) {
  const calls = [
    ['anon', (sp) => sp`SELECT public.stamp_match_rules(${TOURNAMENT})`],
    ['anon', (sp) => sp`SELECT public.build_match_rules(${TOURNAMENT}, 'TF_v1', '1.1.0', null)`],
    ['authenticated', (sp) => sp`SELECT public.stamp_match_rules(${TOURNAMENT})`],
    [
      'authenticated',
      (sp) => sp`SELECT public.build_match_rules(${TOURNAMENT}, 'TF_v1', '1.1.0', null)`,
    ],
    ['anon', (sp) => sp`SELECT public.card_ruleset_held_by_a_bout(${CLUB_CARDS})`],
    ['authenticated', (sp) => sp`SELECT public.card_ruleset_held_by_a_bout(${CLUB_CARDS})`],
    ['anon', (sp) => sp`SELECT public.ruleset_pair_held_by_a_bout(${CLUB_SCORING}, '1.0.0')`],
    [
      'authenticated',
      (sp) => sp`SELECT public.ruleset_pair_held_by_a_bout(${CLUB_SCORING}, '1.0.0')`,
    ],
  ];
  for (const [role, call] of calls) {
    const error = await attempt(tx, role, call);
    if (error?.code !== '42501')
      failures.push(`${role} called a match_rules function (${error?.message ?? 'no error'})`);
  }
  const served = await attempt(
    tx,
    'service_role',
    (sp) => sp`SELECT public.stamp_match_rules(${TOURNAMENT})`,
  );
  if (served) failures.push(`the service role could not stamp (${served.message})`);
}

/** What is wrong, as sentences; none when all is right. */
export async function matchRulesFailures(tx) {
  const failures = [];
  await onlyCopyFailures(tx, failures);
  await stampFailures(tx, failures);
  await quietStampFailures(tx, failures);
  await scoringKeysFailures(tx, failures);
  await cardPinFailures(tx, failures);
  await immutableFailures(tx, failures);
  await heldCardFailures(tx, failures);
  await heldPairFailures(tx, failures);
  await ownTournamentFailures(tx, failures);
  await grantFailures(tx, failures);
  return failures;
}
