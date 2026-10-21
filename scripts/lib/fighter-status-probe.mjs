/**
 * Check 16 of the RLS probe (`scripts/db-rls-probe.mjs`): a Fighter's status is worked out from
 * its causes, by `settle_fighter_status` alone (migrations 0240 and 0241, slice B, operator
 * rulings 57, 78-80, 83, 105-112, 118).
 *
 * The seed's Registration of the published Tournament is the Fighter. Each case writes its causes
 * AS THE OWNER (0238 leaves no web role a write on the Match tables) in a savepoint rolled back:
 * forfeits on bouts of its own, black cards on the seed's bout, a review; then it settles and
 * reads the row back. The hand doors' row writes pass both new CHECKs; each CHECK refuses BY
 * NAME; a web role may not call the function.
 *
 * NOT the lock: every case runs in one rolled-back transaction, so a second settle never waits.
 * The lock is held by its text (0240's DO block), read again here on every replay: a later
 * `create or replace` must not drop it unseen.
 */

import { errorOf, isolated } from './match-rules-probe-kit.mjs';
import {
  AFTER_2,
  CARD_OUT,
  FIGHTER,
  FN,
  LATER,
  NO_2ND,
  NOW,
  RULES,
  card,
  forfeit,
  onWaitlist,
  review,
  rowOf,
  settle,
  twoCards,
  voidCard,
  voidForfeit,
} from './fighter-status-probe-kit.mjs';

/** Causes alone and in pairs: what each leaves the Fighter. */
const CAUSES = [
  { what: 'no cause', rules: RULES, want: 'registered' },
  {
    what: 'a forfeit that withdrew',
    rules: RULES,
    want: 'withdrawn',
    set: (sp) => forfeit(sp, 1, { outcome: 'withdrawn' }),
  },
  {
    what: 'a forfeit that disqualified',
    rules: RULES,
    want: 'disqualified',
    set: (sp) => forfeit(sp, 1, { outcome: 'disqualified' }),
  },
  {
    what: 'a withdrawal and a disqualification',
    rules: RULES,
    want: 'disqualified',
    set: async (sp) => {
      await forfeit(sp, 1, { outcome: 'withdrawn' });
      await forfeit(sp, 2, { outcome: 'disqualified' });
    },
  },
  {
    what: 'a disqualifying forfeit voided',
    rules: RULES,
    want: 'registered',
    set: async (sp) => voidForfeit(sp, await forfeit(sp, 1, { outcome: 'disqualified' })),
  },
  {
    what: 'two counted forfeits, "after 2"',
    rules: AFTER_2,
    want: 'disqualified',
    set: async (sp) => {
      await forfeit(sp, 1);
      await forfeit(sp, 2, { reason: 'voluntary' });
    },
  },
  {
    what: 'two counted forfeits, one voided (ruling 80)',
    rules: AFTER_2,
    want: 'registered',
    set: async (sp) => {
      await voidForfeit(sp, await forfeit(sp, 1));
      await forfeit(sp, 2);
    },
  },
  {
    what: 'two counted forfeits, the count off',
    rules: RULES,
    want: 'registered',
    set: async (sp) => {
      await forfeit(sp, 1);
      await forfeit(sp, 2);
    },
  },
  {
    what: 'a forfeit under a withdrawal (ruling 89)',
    rules: AFTER_2,
    want: 'withdrawn',
    set: async (sp) => forfeit(sp, 2, { parent: await forfeit(sp, 1, { outcome: 'withdrawn' }) }),
  },
  {
    what: 'a forfeit under the hand withdrawal (ruling 118, 0241)',
    rules: AFTER_2,
    want: 'registered',
    set: async (sp) => {
      await forfeit(sp, 1);
      await forfeit(sp, 2, { underHand: true });
    },
  },
  {
    what: 'a bout forfeited with a withdrawal',
    rules: AFTER_2,
    want: 'withdrawn',
    set: async (sp) =>
      forfeit(sp, 2, { auto: true, parent: await forfeit(sp, 1, { outcome: 'withdrawn' }) }),
  },
  {
    what: 'a black card forfeit counts for nothing (ruling 56)',
    rules: AFTER_2,
    want: 'registered',
    set: async (sp) => {
      await forfeit(sp, 1, { reason: 'black_card_1' });
      await forfeit(sp, 2);
    },
  },
  {
    what: 'a 1st black card that ends its bout',
    rules: RULES,
    want: 'registered',
    set: (sp) => card(sp, 1),
  },
  {
    what: 'a 1st black card that reaches the Tournament',
    rules: CARD_OUT,
    want: 'disqualified',
    set: (sp) => card(sp, 1),
  },
  { what: 'a 2nd black card', rules: RULES, want: 'disqualified', set: twoCards },
  {
    what: 'a 2nd black card voided',
    rules: RULES,
    want: 'registered',
    set: async (sp) => voidCard(sp, (await twoCards(sp))[1]),
  },
  {
    what: 'an injury voided under a disqualifying card',
    rules: CARD_OUT,
    want: 'disqualified',
    set: async (sp) => {
      await voidForfeit(sp, await forfeit(sp, 1, { outcome: 'withdrawn' }));
      await card(sp, 1);
    },
  },
  {
    what: 'a card voided under a later withdrawal (ruling 107)',
    rules: CARD_OUT,
    want: 'withdrawn',
    set: async (sp) => {
      await voidCard(sp, await card(sp, 1));
      await forfeit(sp, 4, { outcome: 'withdrawn' });
    },
  },
  {
    what: 'a disqualifying forfeit under a voided withdrawal (ruling 112)',
    rules: RULES,
    want: 'disqualified',
    set: async (sp) => {
      const root = await forfeit(sp, 1, { outcome: 'withdrawn' });
      await forfeit(sp, 2, { parent: root, reason: 'conduct_violation', outcome: 'disqualified' });
      await voidForfeit(sp, root);
    },
  },
  {
    what: 'a confirmed review of two live cards (ruling 79)',
    rules: NO_2ND,
    want: 'disqualified',
    set: async (sp) => review(sp, 'confirmed', await twoCards(sp)),
  },
  {
    what: 'a pending review of two live cards',
    rules: NO_2ND,
    want: 'registered',
    set: async (sp) => review(sp, 'pending', await twoCards(sp)),
  },
  {
    what: 'a confirmed review, one answered card voided (ruling 106)',
    rules: NO_2ND,
    want: 'registered',
    set: async (sp) => {
      const cards = await twoCards(sp);
      await review(sp, 'confirmed', cards);
      await voidCard(sp, cards[0]);
    },
  },
  {
    what: 'a confirmed review, a 3rd card, one answered card voided',
    rules: NO_2ND,
    want: 'registered',
    set: async (sp) => {
      // The review counts the 3rd card too (a confirmed review stays confirmed on a new card).
      const cards = await twoCards(sp);
      await review(sp, 'confirmed', cards, [...cards, await card(sp, 3)]);
      await voidCard(sp, cards[0]);
    },
  },
  { what: 'a hand withdrawal (ruling 110)', rules: RULES, entry: 'withdrawn', want: 'withdrawn' },
  {
    what: 'a hand withdrawal under a voided disqualification',
    rules: RULES,
    entry: 'withdrawn',
    want: 'withdrawn',
    set: async (sp) => voidForfeit(sp, await forfeit(sp, 1, { outcome: 'disqualified' })),
  },
];

const OUT = ['withdrawn', 'disqualified'];

async function causeFailures(tx) {
  const failures = [];
  for (const { what, rules, entry = null, want, set } of CAUSES) {
    await isolated(tx, async (sp) => {
      if (set) await set(sp);
      const answer = await settle(sp, rules, { entry });
      const row = await rowOf(sp);
      const outSince = OUT.includes(want) ? NOW : null;
      if (answer.after !== want || row.status !== want || row.out_since !== outSince) {
        failures.push(
          `check 16: ${what}: wanted ${want} (out since ${outSince}), got ${answer.after} / ` +
            `${row.status} (out since ${row.out_since})`,
        );
      }
    });
  }
  return failures;
}

/** The hand doors' row writes, and the spell out: each step's {status, entry, out since}. */
const SEQUENCES = [
  { what: 'check-in', steps: [[{ entry: 'checked_in' }, 'checked_in', 'checked_in', null]] },
  {
    what: 'a hand withdrawal and its undo (ruling 110)',
    steps: [
      [{ entry: 'withdrawn' }, 'withdrawn', 'withdrawn', NOW],
      [{ entry: 'registered', now: LATER }, 'registered', 'registered', null],
    ],
  },
  {
    what: 'the spell out keeps its start',
    steps: [
      [{ entry: 'withdrawn' }, 'withdrawn', 'withdrawn', NOW],
      [{ now: LATER }, 'withdrawn', 'withdrawn', NOW],
    ],
  },
];

async function sequenceFailures(tx) {
  const failures = [];
  for (const { what, steps } of SEQUENCES) {
    await isolated(tx, async (sp) => {
      for (const [options, status, entry, outSince] of steps) {
        await settle(sp, RULES, options);
        const row = await rowOf(sp);
        if (row.status !== status || row.entry_status !== entry || row.out_since !== outSince) {
          failures.push(
            `check 16: ${what}: wanted ${status}/${entry}/${outSince}, got ` +
              `${row.status}/${row.entry_status}/${row.out_since}`,
          );
        }
      }
    });
  }
  return failures;
}

/** Each refusal, by the constraint or the message that names it. */
const REFUSALS = [
  {
    what: 'a promote that keeps the waitlist seat',
    by: 'registration_waitlist_position_check',
    run: async (sp) => {
      await onWaitlist(sp);
      await settle(sp, RULES, { entry: 'registered', expected: 'waitlist' });
    },
  },
  {
    what: 'a promote of a Fighter promoted since',
    by: 'entry_status_changed',
    run: (sp) => settle(sp, RULES, { entry: 'registered', expected: 'waitlist', clear: true }),
  },
  {
    what: 'a status apart from the hand',
    by: 'registrations_status_follows_entry',
    run: (sp) => sp`UPDATE registrations SET status = 'checked_in' WHERE id = ${FIGHTER}`,
  },
  {
    what: 'an out status with no spell',
    by: 'registrations_out_since_follows_status',
    run: (sp) => sp`UPDATE registrations SET status = 'withdrawn' WHERE id = ${FIGHTER}`,
  },
  {
    what: 'a hand that is no hand',
    by: 'registrations_entry_status_allowed',
    run: (sp) => sp`UPDATE registrations SET entry_status = 'disqualified' WHERE id = ${FIGHTER}`,
  },
  {
    what: 'a forfeit outcome that is none',
    by: 'match_forfeits_fighter_outcome_allowed',
    run: (sp) => forfeit(sp, 1, { outcome: 'continues' }),
  },
];

async function refusalFailures(tx) {
  const failures = [];
  const promoted = await errorOf(tx, async (sp) => {
    await onWaitlist(sp);
    await settle(sp, RULES, { entry: 'registered', expected: 'waitlist', clear: true });
    const row = await rowOf(sp);
    if (row.status !== 'registered' || row.waitlist_position !== null) {
      throw new Error(`promoted to ${row.status}, seat ${row.waitlist_position}`);
    }
  });
  if (promoted) failures.push(`check 16: a promote is refused: ${promoted.message}`);
  for (const { what, by, run } of REFUSALS) {
    const error = await errorOf(tx, run);
    if (error?.constraint_name !== by && !String(error?.message).includes(by)) {
      failures.push(
        `check 16: ${what} is not refused by ${by} (${error ? error.message : 'taken'})`,
      );
    }
  }
  return failures;
}

/** Who may call it, its volatility, and the lock as its first statement. */
async function functionFailures(tx) {
  const [fn] = await tx`
    SELECT has_function_privilege('anon', ${FN}::regprocedure, 'EXECUTE') AS anon,
           has_function_privilege('authenticated', ${FN}::regprocedure, 'EXECUTE') AS authed,
           has_function_privilege('service_role', ${FN}::regprocedure, 'EXECUTE') AS service,
           p.provolatile,
           substring(p.prosrc FROM '\\ybegin\\y(.*)$') ~* ${String.raw`^\s*select\y[^;]*\yfrom\s+public\.registrations\y[^;]*\yfor\s+no\s+key\s+update\s*;`} AS locks
    FROM pg_proc p WHERE p.oid = ${FN}::regprocedure`;
  const failures = [];
  if (fn.anon || fn.authed) failures.push('check 16: a web role may execute settle_fighter_status');
  if (!fn.service)
    failures.push('check 16: the service role may not execute settle_fighter_status');
  if (fn.provolatile !== 'v') failures.push('check 16: settle_fighter_status is not VOLATILE');
  if (!fn.locks)
    failures.push('check 16: settle_fighter_status does not lock the Registration first');
  return failures;
}

/** What is wrong, as sentences; none when all is right. */
export async function fighterStatusFailures(tx) {
  const [exists] = await tx`SELECT to_regprocedure(${FN}) IS NOT NULL AS ok`;
  if (!exists.ok) return ['check 16: settle_fighter_status does not exist'];
  return [
    ...(await functionFailures(tx)),
    ...(await causeFailures(tx)),
    ...(await sequenceFailures(tx)),
    ...(await refusalFailures(tx)),
  ];
}
