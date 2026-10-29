/**
 * Check 19 of the RLS probe (`scripts/db-rls-probe.mjs`): which Fighters a change of a
 * Tournament's forfeit rules moves, and in what order (migration 0246; operator rulings 143, 146,
 * 150, 157-160).
 *
 * `fighter_status_under` is the one owner of the status rule and of `crossed_at`, when the cause
 * that puts a Fighter out happened, by the SERVER's clocks: the N-th counted forfeit's
 * `created_at`, the 1st or 2nd live black card's `recorded_at` (never the tablet's `occurred_at`),
 * a confirmed review's `reviewed_at`, a forfeit outcome's `created_at`; NULL when in, or out by the
 * hand alone. `fighters_status_under` lists the Registrations of ONE Tournament whose status the
 * change moves, those out of step with the rules after, and those the caller names, ordered by
 * `crossed_at`, then id. The Fighters are seeded with ids in the REVERSE of their crossing order, so
 * an order by id alone is seen. Neither web role may call either function; the service role may.
 * Every case runs in a savepoint always rolled back.
 */

import { BOUT, PHASE, SEED_COPY, TOURNAMENT, isolated } from './match-rules-probe-kit.mjs';
import { attempt } from './ruleset-pair-probe.mjs';

const UNDER = 'public.fighter_status_under(uuid, jsonb, text)';
const MANY = 'public.fighters_status_under(uuid, jsonb, jsonb, uuid[])';
const EVENT = 'eeeeeeee-0000-4000-8000-00000000000a';
const SEED_FIGHTER = 'cccccccc-0000-4000-8000-00000000000a';
const OPPONENT = 'c0f00000-0000-4000-8000-00000000000a';
// A Registration of the seed's OTHER Tournament: never listed for this one.
const FOREIGN = 'cccccccc-0000-4000-8000-00000000000c';

const OFF = {
  disqualifyAfter: null,
  firstCardOut: false,
  secondCardOut: true,
  countedReasons: ['injury', 'voluntary', 'conduct_violation'],
};
const AFTER_2 = { ...OFF, disqualifyAfter: 2 };
const CARD_OUT = { ...OFF, firstCardOut: true };
const NO_CARDS = { ...OFF, secondCardOut: false };

const at = (time) => `2026-10-21T${time}:00.000Z`;
const id = (n) => `c1900000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

/** A Fighter of the published Tournament with its own person; its id. */
async function fighter(sp, n) {
  const person = `b1900000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
  await sp`INSERT INTO persons (id, event_id, given_name, family_name)
           VALUES (${person}, ${EVENT}, 'Check 19', ${`Fighter ${n}`})`;
  await sp`INSERT INTO registrations (id, tournament_id, person_id)
           VALUES (${id(n)}, ${TOURNAMENT}, ${person})`;
  return id(n);
}

let bouts = 0;
/** A forfeit of `who` on a bout of its own, recorded at `time`; its id. */
async function forfeit(sp, who, time, { outcome = null, parent = null, underOut = false } = {}) {
  bouts += 1;
  const bout = `d1900000-0000-4000-8000-${String(bouts).padStart(12, '0')}`;
  await sp`INSERT INTO matches (id, phase_id, match_rules_id) VALUES (${bout}, ${PHASE}, ${SEED_COPY})`;
  const [row] = await sp`
    INSERT INTO match_forfeits (match_id, tournament_id, forfeiting_registration_id,
                                winner_registration_id, reason, score_policy, fighter_outcome,
                                parent_forfeit_id, under_out_status, created_at)
    VALUES (${bout}, ${TOURNAMENT}, ${who}, ${OPPONENT}, 'injury', 'fixed_loss', ${outcome},
            ${parent}, ${underOut}, ${at(time)})
    RETURNING id`;
  return row.id;
}

let sequence = 200;
/** A black card of `who` on the seed's bout, given at `occurred` and recorded at `recorded`. */
async function card(sp, who, recorded, { occurred = recorded, voided = false } = {}) {
  sequence += 1;
  const [row] = await sp`
    INSERT INTO match_penalties (client_uuid, match_id, tournament_id, registration_id, sequence,
                                 card, occurred_at, recorded_at, voided)
    VALUES (gen_random_uuid(), ${BOUT}, ${TOURNAMENT}, ${who}, ${sequence}, 'black',
            ${at(occurred)}, ${at(recorded)}, ${voided})
    RETURNING id`;
  return row.id;
}

const under = async (sp, who, rules, entry = 'registered') =>
  (
    await sp`SELECT u.status, to_char(u.crossed_at AT TIME ZONE 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS crossed_at
             FROM public.fighter_status_under(${who}::uuid, ${sp.json(rules)}, ${entry}) u`
  )[0];

const settle = (sp, who, rules) =>
  sp`SELECT public.settle_fighter_status(${who}::uuid, ${sp.json(rules)}, ${at('12:00')}::timestamptz,
       null, null, false)`;

const listed = async (sp, before, after, also = []) =>
  (
    await sp`SELECT registration_id, status_now, status_before, status_after,
                    to_char(crossed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS crossed_at
             FROM public.fighters_status_under(${TOURNAMENT}::uuid, ${sp.json(before)},
                                               ${sp.json(after)}, ${also}::uuid[])`
  ).map((row) => ({ ...row }));

/** Each arm of `crossed_at`, alone: what the rule answers, by the server's clocks. */
const ARMS = [
  {
    what: 'the 2nd counted forfeit; one under the out status and one under a withdrawal skipped',
    rules: AFTER_2,
    want: { status: 'disqualified', crossed_at: at('10:20') },
    set: async (sp, who) => {
      const first = await forfeit(sp, who, '10:00');
      await forfeit(sp, who, '10:05', { parent: first });
      await forfeit(sp, who, '10:10', { underOut: true });
      await forfeit(sp, who, '10:20');
    },
  },
  {
    what: 'the 1st live black card, a voided one skipped',
    rules: CARD_OUT,
    want: { status: 'disqualified', crossed_at: at('10:30') },
    set: async (sp, who) => {
      await card(sp, who, '10:00', { voided: true });
      await card(sp, who, '10:30');
    },
  },
  {
    what: 'the 2nd card under the 2nd card’s rule',
    rules: OFF,
    want: { status: 'disqualified', crossed_at: at('10:30') },
    set: async (sp, who) => {
      await card(sp, who, '10:00');
      await card(sp, who, '10:30');
    },
  },
  {
    // The 1st card alone puts out: under both card rules the earliest of two would hide the order.
    what: 'the card recorded first, though given last (recorded_at, not occurred_at)',
    rules: { ...CARD_OUT, secondCardOut: false },
    want: { status: 'disqualified', crossed_at: at('10:10') },
    set: async (sp, who) => {
      await card(sp, who, '10:40', { occurred: '09:00' });
      await card(sp, who, '10:10', { occurred: '09:30' });
    },
  },
  {
    what: 'a confirmed review, at its answer',
    rules: NO_CARDS,
    want: { status: 'disqualified', crossed_at: at('11:00') },
    set: async (sp, who) => {
      const cards = [await card(sp, who, '10:00'), await card(sp, who, '10:30')];
      await sp`INSERT INTO tournament_penalty_reviews (tournament_id, registration_id, status,
                 black_card_count, payload_json, reviewed_at)
               VALUES (${TOURNAMENT}, ${who}, 'confirmed', 2,
                       ${sp.json({ penaltyIds: cards, answeredPenaltyIds: cards })}, ${at('11:00')})`;
    },
  },
  {
    what: 'a forfeit that withdrew, at its time',
    rules: OFF,
    want: { status: 'withdrawn', crossed_at: at('10:15') },
    set: (sp, who) => forfeit(sp, who, '10:15', { outcome: 'withdrawn' }),
  },
  {
    what: 'the earliest of two causes that hold',
    rules: CARD_OUT,
    want: { status: 'disqualified', crossed_at: at('09:45') },
    set: async (sp, who) => {
      await card(sp, who, '10:30');
      await forfeit(sp, who, '09:45', { outcome: 'withdrawn' });
    },
  },
  {
    what: 'out by the hand alone',
    rules: OFF,
    entry: 'withdrawn',
    want: { status: 'withdrawn', crossed_at: null },
  },
  { what: 'no cause', rules: AFTER_2, want: { status: 'registered', crossed_at: null } },
];

async function armFailures(tx, failures) {
  for (const { what, rules, entry, want, set } of ARMS) {
    await isolated(tx, async (sp) => {
      const who = await fighter(sp, 1);
      if (set) await set(sp, who);
      const got = await under(sp, who, rules, entry);
      if (JSON.stringify(got) !== JSON.stringify(want))
        failures.push(
          `check 19: ${what}: wanted ${JSON.stringify(want)}, got ${JSON.stringify(got)}`,
        );
    });
  }
}

/**
 * Four Fighters, ids in the reverse of their crossing order: A crosses "after 2" at 10:00, B at
 * 10:10, C at 10:20; E was disqualified by a forfeit at 10:05 and never settled (out of step); D
 * has one counted forfeit (moved by nothing). The seed's two Fighters have no cause.
 */
async function seedFour(sp) {
  const [c, b, a, d, e] = [
    await fighter(sp, 1),
    await fighter(sp, 2),
    await fighter(sp, 3),
    await fighter(sp, 4),
    await fighter(sp, 5),
  ];
  for (const [who, first, second] of [
    [a, '09:50', '10:00'],
    [b, '09:55', '10:10'],
    [c, '09:58', '10:20'],
  ]) {
    await forfeit(sp, who, first);
    await forfeit(sp, who, second);
  }
  await forfeit(sp, d, '09:40');
  await forfeit(sp, e, '10:05', { outcome: 'disqualified' });
  return { a, b, c, d, e };
}

const row = (registration_id, now, before, after, crossed) => ({
  registration_id,
  status_now: now,
  status_before: before,
  status_after: after,
  crossed_at: crossed && at(crossed),
});

/** G crossed first (09:00) and is settled: in step, listed only when the caller names it. */
async function settledFirst(sp) {
  const g = await fighter(sp, 6);
  await forfeit(sp, g, '09:00', { outcome: 'disqualified' });
  await settle(sp, g, AFTER_2);
  return g;
}

/** Each listing over `seedFour`: what the caller asks, and the rows wanted, in order. */
const SETS = [
  {
    what: '"after 2" switched on lists the moved and the out of step, by crossing',
    ask: async () => [OFF, AFTER_2],
    want: ({ a, b, c, e }) => [
      row(a, 'registered', 'registered', 'disqualified', '10:00'),
      row(e, 'registered', 'disqualified', 'disqualified', '10:05'),
      row(b, 'registered', 'registered', 'disqualified', '10:10'),
      row(c, 'registered', 'registered', 'disqualified', '10:20'),
    ],
  },
  {
    what: '"after 2" switched off lists those coming back last, by id',
    ask: async (sp, { a }) => (await settle(sp, a, AFTER_2), [AFTER_2, OFF]),
    want: ({ a, b, c, e }) => [
      row(e, 'registered', 'disqualified', 'disqualified', '10:05'),
      row(c, 'registered', 'disqualified', 'registered', null),
      row(b, 'registered', 'disqualified', 'registered', null),
      row(a, 'disqualified', 'disqualified', 'registered', null),
    ],
  },
  {
    what: 'the named: in step in crossing order, a foreign id dropped, one listed twice once',
    ask: async (sp, f) => {
      f.g = await settledFirst(sp);
      return [AFTER_2, AFTER_2, [OPPONENT, FOREIGN, f.c, f.g]];
    },
    want: ({ a, b, c, e, g }) => [
      row(g, 'disqualified', 'disqualified', 'disqualified', '09:00'),
      row(a, 'registered', 'disqualified', 'disqualified', '10:00'),
      row(e, 'registered', 'disqualified', 'disqualified', '10:05'),
      row(b, 'registered', 'disqualified', 'disqualified', '10:10'),
      row(c, 'registered', 'disqualified', 'disqualified', '10:20'),
      row(OPPONENT, 'registered', 'registered', 'registered', null),
    ],
  },
  {
    // E settled first: no one is out of step, and the change moves no one.
    what: 'a change that moves no one, nothing out of step, lists no one',
    ask: async (sp, { e }) => (await settle(sp, e, OFF), [NO_CARDS, OFF]),
    want: () => [],
  },
];

async function setFailures(tx, failures) {
  for (const { what, ask, want } of SETS) {
    await isolated(tx, async (sp) => {
      const fighters = await seedFour(sp);
      const [before, after, also] = await ask(sp, fighters);
      const got = await listed(sp, before, after, also);
      if (JSON.stringify(got) !== JSON.stringify(want(fighters)))
        failures.push(
          `check 19: ${what}: wanted ${JSON.stringify(want(fighters))}, got ${JSON.stringify(got)}`,
        );
    });
  }
}

/** Neither web role may call either function, by its own name; the service role may. */
async function grantFailures(tx, failures) {
  const calls = {
    fighter_status_under: (sp) => under(sp, SEED_FIGHTER, OFF),
    fighters_status_under: (sp) => listed(sp, OFF, OFF),
  };
  for (const [name, signature] of [
    ['fighter_status_under', UNDER],
    ['fighters_status_under', MANY],
  ]) {
    const [privilege] = await tx`
      SELECT has_function_privilege('anon', ${signature}, 'execute') AS anon,
             has_function_privilege('authenticated', ${signature}, 'execute') AS authed,
             has_function_privilege('service_role', ${signature}, 'execute') AS service`;
    if (privilege.anon || privilege.authed)
      failures.push(`check 19: a web role holds EXECUTE on ${name}`);
    if (!privilege.service) failures.push(`check 19: the service role holds no EXECUTE on ${name}`);
    for (const role of ['anon', 'authenticated']) {
      const error = await attempt(tx, role, calls[name]);
      if (error?.code !== '42501' || !error.message.includes(`function ${name}`))
        failures.push(`check 19: ${role} called ${name} (${error?.message ?? 'no error'})`);
    }
    const served = await attempt(tx, 'service_role', calls[name]);
    if (served)
      failures.push(`check 19: the service role could not call ${name} (${served.message})`);
  }
}

/** What is wrong, as sentences; none when all is right. */
export async function fightersStatusUnderFailures(tx) {
  const [exists] =
    await tx`SELECT to_regprocedure(${UNDER}) IS NOT NULL AND to_regprocedure(${MANY}) IS NOT NULL AS ok`;
  if (!exists.ok) return ['check 19: fighter_status_under or fighters_status_under does not exist'];
  const failures = [];
  await grantFailures(tx, failures);
  await armFailures(tx, failures);
  await setFailures(tx, failures);
  return failures;
}
