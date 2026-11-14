import { Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FightBookSettings, PublicSparLine, SparStars } from '@myclash/types';
import { logReason, unreadable } from '../../common/log-reason';
import { MARK_GRACE_MS } from './spar-windows';

const logger = new Logger('FightBookPublicLine');

type Db = Pick<SupabaseClient, 'from' | 'rpc'>;

/** The stars of one fighter, or null before their first review. */
async function readStars(db: Db, subject: string): Promise<SparStars | null> {
  const { data, error } = await db.rpc('fightbook_star_line', { p_subject: subject });
  if (error) throw unreadable('FightBook star line read failed', error);
  const line = data as { average: number | null; count: number } | null;
  return line && line.count >= 1 && line.average !== null
    ? { average: line.average, count: line.count }
    : null;
}

/**
 * Spars done by `person`, either side, that nobody can undo any more: `done` and past the grace
 * after the spar day (`expires_at <= now - 48 h`). A count read, no rows.
 */
async function countSparred(db: Db, person: string, now: Date): Promise<number> {
  const settled = new Date(now.getTime() - MARK_GRACE_MS).toISOString();
  const { count, error } = await db
    .from('spar_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'done')
    .lte('expires_at', settled)
    .or(`asker_global_person_id.eq.${person},receiver_global_person_id.eq.${person}`);
  if (error) throw unreadable('FightBook sparred count failed', error);
  return count ?? 0;
}

/**
 * The line under a fighter's name on the public page. Null unless FightBook is on for them. The
 * stars show only when they switched them on and have a review (a count of 1 is enough, ruling
 * 689). Reads its own two switches: the public columns are shared with the directory and are not
 * widened, and neither switch leaves this function. FightBook is an add-on to a core page: a
 * failed read logs a warning and answers null, so the profile still renders.
 */
export async function readPublicSparLine(
  db: Db,
  globalPersonId: string,
  now: Date = new Date(),
): Promise<PublicSparLine | null> {
  try {
    return await publicLine(db, globalPersonId, now);
  } catch (error) {
    logger.warn(`Public FightBook line left out: ${logReason(error)}`);
    return null;
  }
}

async function publicLine(
  db: Db,
  globalPersonId: string,
  now: Date,
): Promise<PublicSparLine | null> {
  const { data, error } = await db
    .from('global_persons')
    .select('fightbook_enabled, fightbook_show_stars')
    .eq('id', globalPersonId)
    .maybeSingle();
  if (error) throw unreadable('FightBook switch read failed', error);
  const row = data as { fightbook_enabled: boolean; fightbook_show_stars: boolean } | null;
  if (row?.fightbook_enabled !== true) return null;

  const sparred = await countSparred(db, globalPersonId, now);
  const stars = row.fightbook_show_stars === true ? await readStars(db, globalPersonId) : null;
  return { sparred, stars };
}

/**
 * The caller's own line in settings: the stars whenever there is a review, whatever the switch.
 * It degrades like the public line: a failed read logs one warning and answers no line (both
 * null), so the rest of the FightBook page still loads.
 */
export async function readOwnSparLine(
  db: Db,
  me: string,
  now: Date = new Date(),
): Promise<Pick<FightBookSettings, 'sparred' | 'stars'>> {
  try {
    const [sparred, stars] = await Promise.all([countSparred(db, me, now), readStars(db, me)]);
    return { sparred, stars };
  } catch (error) {
    logger.warn(`Own FightBook line left out: ${logReason(error)}`);
    return { sparred: null, stars: null };
  }
}
