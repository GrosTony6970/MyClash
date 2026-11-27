/**
 * archive-fighter-status.ts — the status columns an archive made before migration 0240 lacks.
 *
 * Since 0240 a Fighter's status is worked out from its causes: what each forfeit did to its
 * Fighter (`match_forfeits.fighter_outcome`), the organiser's hand (`registrations.entry_status`),
 * when the Fighter's spell out began (`registrations.out_since`), and the cards a confirmed review
 * answered (`payload_json.answeredPenaltyIds`). An older archive carries the status and none of
 * the causes' columns, so its rows are filled on restore, from the archive alone (it reads no
 * rules), each only when the row lacks its key (a newer archive keeps its own):
 *
 * - a forfeit: 'withdrawn' on a live root forfeit the Fighter chose that withdrew them
 *   (`can_continue = false`); 'disqualified' on the Fighter's latest live forfeit they chose (root,
 *   or recorded again under a withdrawal: ruling 112) when they are disqualified and nothing else
 *   in the archive could explain it (no live black card, no confirmed review, no 2nd live root they
 *   chose, which "disqualify after N" could count); a black card forfeit recorded by hand (no card
 *   on its bout) is such a forfeit too; null otherwise;
 * - a Registration: the hand is the status when they are in; 'withdrawn' when they are withdrawn
 *   with no live forfeit of their own (the organiser's hand); otherwise checked in. Out since the
 *   oldest live bout forfeited with them, else their latest live root forfeit that put them out,
 *   else the restore: the organiser's put-backs of the restored spell then count as this spell's;
 * - a confirmed review: the cards it answered are the cards it counted.
 *
 * Lost, and said: which forfeit disqualified a Fighter whom something else could have put out. Such
 * a Fighter is restored with no forfeit stored as disqualifying, and a later settle decides from
 * the cards, the review and the count. And when a black card forfeit recorded by hand whose rule
 * only ended its bout came after the forfeit that disqualified, the fill takes the latest one as
 * the cause: voiding it brings the Fighter back in. And the forfeit that reached "disqualify after N" was saved
 * with `can_continue = false` whatever its reason asked: without the rules, the fill takes it as a
 * withdrawal, where a live insert stores nothing. The restore itself settles nobody: the status is
 * kept as archived.
 */
import { COUNTED_FORFEIT_REASONS, isBlackCardReason } from '@myclash/rulesets';
import type { ArchiveRow, ArchiveTables } from './archive.types';

type Tables = Pick<
  ArchiveTables,
  'registrations' | 'matchForfeits' | 'matchPenalties' | 'tournamentPenaltyReviews'
>;

const OUT = new Set(['withdrawn', 'disqualified']);
const COUNTED = new Set<string>(COUNTED_FORFEIT_REASONS);

const isLive = (forfeit: ArchiveRow) => forfeit['voided_at'] == null;
/** A forfeit the Fighter chose: not a bout forfeited with a withdrawal, a black card, an override. */
const isChosen = (forfeit: ArchiveRow) =>
  isLive(forfeit) && forfeit['auto_created'] !== true && COUNTED.has(String(forfeit['reason']));
const isRoot = (forfeit: ArchiveRow) => forfeit['parent_forfeit_id'] == null;
const madeAt = (row: ArchiveRow) => String(row['created_at'] ?? '');
/** The Fighter a forfeit names; a team's names none, and a team has no status (decision 7). */
const fighterOf = (forfeit: ArchiveRow): string | null => {
  const id = forfeit['forfeiting_registration_id'];
  return typeof id === 'string' ? id : null;
};

function byFighter(forfeits: ArchiveRow[]): Map<string, ArchiveRow[]> {
  const out = new Map<string, ArchiveRow[]>();
  for (const forfeit of forfeits) {
    const fighter = fighterOf(forfeit);
    if (fighter !== null) out.set(fighter, [...(out.get(fighter) ?? []), forfeit]);
  }
  return out;
}

/**
 * The live black cards of a Fighter, as `[registration id, card]`. A team's card names no
 * Registration (0282) and puts no Fighter out: it is left out, never keyed as "null".
 */
const fighterBlackCards = (data: Tables): [string, ArchiveRow][] =>
  data.matchPenalties.flatMap((card) => {
    const id = card['registration_id'];
    const live = card['card'] === 'black' && card['voided'] !== true;
    return live && typeof id === 'string' ? [[id, card] as [string, ArchiveRow]] : [];
  });

/** The Fighters of `data` a live black card or a confirmed review could have put out. */
function otherCauses(data: Tables): Set<string> {
  const cards = fighterBlackCards(data).map(([id]) => id);
  const reviews = data.tournamentPenaltyReviews
    .filter((review) => review['status'] === 'confirmed')
    .map((review) => String(review['registration_id']));
  return new Set([...cards, ...reviews]);
}

/**
 * A black card forfeit recorded by hand: live, and no live black card of its Fighter on its bout
 * (the card door writes its card first). It has no card to count, so it is its own cause, as a live
 * insert stores it (rulings 58, 82).
 */
function handCardForfeits(data: Tables): (forfeit: ArchiveRow) => boolean {
  const carded = new Set(
    fighterBlackCards(data).map(([id, card]) => `${id}@${String(card['match_id'])}`),
  );
  return (forfeit) => {
    // A team's forfeit is no Fighter's: no key is built for it.
    const fighter = fighterOf(forfeit);
    return (
      fighter !== null &&
      isLive(forfeit) &&
      forfeit['auto_created'] !== true &&
      isBlackCardReason(String(forfeit['reason'])) &&
      !carded.has(`${fighter}@${String(forfeit['match_id'])}`)
    );
  };
}

function forfeitOutcomes(data: Tables): ArchiveRow[] {
  const isHandCard = handCardForfeits(data);
  const mayCause = (forfeit: ArchiveRow) => isChosen(forfeit) || isHandCard(forfeit);
  const candidates = byFighter(data.matchForfeits.filter(mayCause));
  const explained = otherCauses(data);
  const status = new Map(data.registrations.map((row) => [String(row['id']), row['status']]));
  const outcomeOf = (forfeit: ArchiveRow): string | null => {
    const fighter = fighterOf(forfeit);
    // A team's forfeit is the cause of no status: it stores no outcome.
    if (fighter === null || !mayCause(forfeit)) return null;
    const own = candidates.get(fighter) ?? [];
    const latest = [...own].sort((a, b) => madeAt(b).localeCompare(madeAt(a)))[0];
    const disqualifiedByIt =
      status.get(fighter) === 'disqualified' &&
      latest === forfeit &&
      !explained.has(fighter) &&
      own.filter((one) => isChosen(one) && isRoot(one)).length < 2;
    if (disqualifiedByIt) return 'disqualified';
    const withdrew = isChosen(forfeit) && isRoot(forfeit) && forfeit['can_continue'] === false;
    return withdrew ? 'withdrawn' : null;
  };
  return data.matchForfeits.map((forfeit) =>
    Object.hasOwn(forfeit, 'fighter_outcome')
      ? forfeit
      : { ...forfeit, fighter_outcome: outcomeOf(forfeit) },
  );
}

function entries(data: Tables, forfeits: ArchiveRow[], restoredAt: string): ArchiveRow[] {
  const live = byFighter(forfeits.filter(isLive));
  return data.registrations.map((row) => {
    if (Object.hasOwn(row, 'entry_status')) return row;
    const status = String(row['status']);
    if (!OUT.has(status)) return { ...row, entry_status: status, out_since: null };
    const own = live.get(String(row['id'])) ?? [];
    const byHand = own.every((forfeit) => forfeit['auto_created'] === true);
    const oldestChild = own
      .filter((forfeit) => forfeit['auto_created'] === true)
      .map(madeAt)
      .sort()[0];
    const latestCause = own
      .filter((forfeit) => isRoot(forfeit) && forfeit['fighter_outcome'] != null)
      .map(madeAt)
      .sort()
      .at(-1);
    return {
      ...row,
      entry_status: status === 'withdrawn' && byHand ? 'withdrawn' : 'checked_in',
      out_since: oldestChild ?? latestCause ?? restoredAt,
    };
  });
}

function answeredReviews(data: Tables): ArchiveRow[] {
  return data.tournamentPenaltyReviews.map((review) => {
    const payload = (review['payload_json'] ?? {}) as Record<string, unknown>;
    if (review['status'] !== 'confirmed' || Object.hasOwn(payload, 'answeredPenaltyIds')) {
      return review;
    }
    const counted = Array.isArray(payload['penaltyIds']) ? payload['penaltyIds'] : [];
    return { ...review, payload_json: { ...payload, answeredPenaltyIds: counted } };
  });
}

/** `data`'s four tables with the status columns filled where a row lacks them (above). */
export function withFighterStatusCauses(data: Tables, restoredAt: string): Tables {
  const matchForfeits = forfeitOutcomes(data);
  return {
    registrations: entries(data, matchForfeits, restoredAt),
    matchForfeits,
    matchPenalties: data.matchPenalties,
    tournamentPenaltyReviews: answeredReviews(data),
  };
}
