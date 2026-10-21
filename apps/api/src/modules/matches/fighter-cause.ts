import { COUNTED_FORFEIT_REASONS, type ForfeitReason } from '@myclash/rulesets';
import type { ForfeitRulesInForce } from '@myclash/types/forfeit-rules';
import { blackCardEffectOf } from '../penalties/card-rules-pin';
import type { BoutDeps } from './fighter-bouts';

/**
 * What the status reconcile reads of a Fighter (`fighter-reconcile.ts`): their row, their live
 * forfeits, why they are out, and the Fighters out across a bout just put back.
 */

type Client = BoutDeps['db'];
type Row = Record<string, unknown>;

export const isOut = (status: string) => status === 'withdrawn' || status === 'disqualified';

/** A Fighter as the reconcile reads them, after their settle. */
export interface Fighter {
  id: string;
  tournamentId: string;
  status: string;
  /** Set exactly while they are out (`registrations_out_since_follows_status`, 0240). */
  outSince: string | null;
}

/** A read that failed decides nothing: a plain Error (a 5xx), never "no row". */
export function rowsOf(
  what: string,
  result: { data: unknown; error: { message: string } | null },
): Row[] {
  if (result.error) throw new Error(`${what} could not be read: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

const fighterOf = (row: Row): Fighter => ({
  id: row['id'] as string,
  tournamentId: row['tournament_id'] as string,
  status: row['status'] as string,
  outSince: (row['out_since'] as string | null) ?? null,
});

export async function readFighter(db: Client, registrationId: string): Promise<Fighter> {
  const result = await db
    .from('registrations')
    .select('id, tournament_id, status, out_since')
    .eq('id', registrationId);
  const row = rowsOf(`Registration ${registrationId}`, result)[0];
  if (!row) throw new Error(`Registration ${registrationId} is gone`);
  return fighterOf(row);
}

/**
 * The Fighters out of the Tournament who face `fighterId` on these bouts. A bout put back faces two
 * Fighters, and the settle that put it back followed one: the other, out, still forfeits it.
 */
export async function outOpponents(
  db: Client,
  fighterId: string,
  matchIds: string[],
): Promise<Fighter[]> {
  if (matchIds.length === 0) return [];
  const bouts = rowsOf(
    'The bouts put back',
    await db
      .from('matches')
      .select('id, red_registration_id, blue_registration_id')
      .in('id', [...new Set(matchIds)]),
  );
  const others = new Set(
    bouts
      .flatMap((bout) => [bout['red_registration_id'], bout['blue_registration_id']])
      .filter((id): id is string => typeof id === 'string' && id !== fighterId),
  );
  if (others.size === 0) return [];
  const rows = rowsOf(
    'The opponents of the bouts put back',
    await db
      .from('registrations')
      .select('id, tournament_id, status, out_since')
      .in('id', [...others])
      .in('status', ['withdrawn', 'disqualified']),
  );
  return rows.map(fighterOf);
}

/** The Fighter's live forfeits in their Tournament, oldest first. */
export async function liveForfeitsOf(db: Client, fighter: Fighter): Promise<Row[]> {
  const result = await db
    .from('match_forfeits')
    .select(
      'id, match_id, reason, fighter_outcome, parent_forfeit_id, auto_created, under_out_status, previous_match_state, resulting_match_state, created_at',
    )
    .eq('tournament_id', fighter.tournamentId)
    .eq('forfeiting_registration_id', fighter.id)
    .is('voided_at', null)
    .order('created_at', { ascending: true });
  return rowsOf('The live forfeits of the Fighter', result);
}

/** Why the Fighter is out: the reason their bouts are forfeited for, and the record they hang off. */
export interface Cause {
  reason: ForfeitReason;
  parentForfeitId: string | null;
}

/**
 * The strongest live cause, oldest first: a forfeit that disqualified, the black cards, a confirmed
 * review, "disqualify after N", a forfeit that withdrew, the organiser's hand. A forfeit scores the
 * bouts as its reason does (a draw when that reason draws, ruling 71) and they hang off its root;
 * a card or the review as a black card (ruling 69); the hand as a voluntary forfeit (ruling 110).
 * The count is the database's (0242): no record under a root, nor under the out status.
 */
export async function causeOf(
  db: Client,
  fighter: Fighter,
  rules: ForfeitRulesInForce,
  forfeits: Row[],
): Promise<Cause> {
  const ownOutcome = (outcome: string) => forfeits.find((f) => f['fighter_outcome'] === outcome);
  const fromForfeit = (f: Row): Cause => ({
    reason: f['reason'] as ForfeitReason,
    parentForfeitId: (f['parent_forfeit_id'] as string | null) ?? (f['id'] as string),
  });
  if (fighter.status === 'disqualified') {
    const disqualifying = ownOutcome('disqualified');
    if (disqualifying) return fromForfeit(disqualifying);
    const byCards = await cardCause(db, fighter, rules);
    if (byCards) return byCards;
    const counted = forfeits.filter(
      (f) =>
        !f['auto_created'] &&
        f['parent_forfeit_id'] == null &&
        f['under_out_status'] !== true &&
        (COUNTED_FORFEIT_REASONS as readonly unknown[]).includes(f['reason']),
    );
    const after = rules.disqualifyAfter;
    if (after !== 'off' && counted.length >= after) return fromForfeit(counted[after - 1]!);
  }
  const withdrawing = ownOutcome('withdrawn');
  if (withdrawing) return fromForfeit(withdrawing);
  return { reason: 'voluntary', parentForfeitId: null };
}

/** The black cards' cause, or the confirmed review's while two of its cards are live. */
async function cardCause(
  db: Client,
  fighter: Fighter,
  rules: ForfeitRulesInForce,
): Promise<Cause | null> {
  const cards = rowsOf(
    'The black cards of the Fighter',
    await db
      .from('match_penalties')
      .select('id')
      .eq('tournament_id', fighter.tournamentId)
      .eq('registration_id', fighter.id)
      .eq('card', 'black')
      .eq('voided', false),
  ).map((card) => card['id'] as string);
  const byCard = (reason: ForfeitReason): Cause => ({ reason, parentForfeitId: null });
  if (cards.length >= 1 && blackCardEffectOf(rules, 'black_card_1') === 'tournament') {
    return byCard('black_card_1');
  }
  if (cards.length >= 2 && blackCardEffectOf(rules, 'black_card_2') === 'tournament') {
    return byCard('black_card_2');
  }
  const review = rowsOf(
    'The second black card review',
    await db
      .from('tournament_penalty_reviews')
      .select('status, payload_json')
      .eq('tournament_id', fighter.tournamentId)
      .eq('registration_id', fighter.id)
      .eq('review_type', 'second_black_card'),
  )[0];
  const answered = ((review?.['payload_json'] as Row | null)?.['answeredPenaltyIds'] ??
    []) as unknown[];
  const stands =
    review?.['status'] === 'confirmed' &&
    answered.filter((id) => cards.includes(id as string)).length >= 2;
  return stands ? byCard('black_card_2') : null;
}
