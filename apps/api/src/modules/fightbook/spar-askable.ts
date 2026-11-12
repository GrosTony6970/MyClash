/**
 * Who a fighter may ask for a spar (FightBook slice 2, Decision 1): a live, claimed profile with
 * FightBook on, not the caller, and not one the caller blocked. Whether that fighter blocked the
 * caller is never read here (ruling 672): an ask to them "sends" like any other and ends "Not this
 * time" (`fightbook_ask`), so no answer of this module may differ because of it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { FAVOURITES_MAX } from '@myclash/types';
import { inListChunks } from '../../common/postgrest-in-list';
import { applyReachable } from '../fighters/directory-predicate';

type Db = Pick<SupabaseClient, 'from'>;

/**
 * A builder's `eq`, called through this view. A constraint naming `eq` makes TypeScript match
 * supabase-js's generic `eq` and throw TS2589 at the call site (as `weapon-catalog.util.ts` says);
 * every PostgREST filter builder has it.
 */
interface BooleanFilter<T> {
  eq(column: string, value: boolean): T;
}

/**
 * The PostgREST filter chain of a profile on FightBook: live (`applyReachable`), switched on and
 * claimed. The one owner, so that a fighter the Inbox can answer, the people pages can ask and
 * the browse lists are the same set (the database's `fightbook_ask` checks the same three).
 */
export function applyFightBookOn<
  T extends {
    is(column: string, value: null): T;
    not(column: string, operator: 'is', value: null): T;
  },
>(query: T): T {
  const live = applyReachable(query) as unknown as BooleanFilter<T>;
  return live.eq('fightbook_enabled', true).not('claimed_by_user_id', 'is', null);
}

/** A builder's `eq` on a text value, through the same view as `BooleanFilter`. */
interface TextFilter<T> {
  eq(column: string, value: string): T;
}

/**
 * The `global_persons` columns to select, with the embed `applyWeapon` filters on when a weapon is
 * set. `!inner` makes the filter drop the fighter, not only the embedded rows; the embed answers
 * the matching weapon only, so a fighter who declared several still comes back once (probed on
 * PostgREST v14.16, the task 6 report). Without a weapon there is no embed: an inner join would
 * drop every fighter who declared none.
 */
export const weaponColumns = (columns: string, weaponId: string | undefined): string =>
  weaponId ? `${columns}, fighter_weapons!inner(weapon_id)` : columns;

/**
 * Only fighters who declared this catalog weapon, any of theirs (not only the ones a card shows).
 * The one owner of the weapon filter: the query must select `weaponColumns(…, weaponId)`.
 */
export function applyWeapon<T>(query: T, weaponId: string | undefined): T {
  if (!weaponId) return query;
  return (query as unknown as TextFilter<T>).eq('fighter_weapons.weapon_id', weaponId);
}

/**
 * Of these profiles, those on FightBook (and declaring `weaponId`, when set). Read in pieces: an
 * Event of 300 must not 5xx.
 */
export async function fightBookOnFighters(
  db: Db,
  ids: string[],
  weaponId?: string,
): Promise<Set<string>> {
  const on = new Set<string>();
  for (const piece of inListChunks([...new Set(ids)])) {
    const query = applyFightBookOn(db.from('global_persons').select(weaponColumns('id', weaponId)));
    const { data, error } = await applyWeapon(query, weaponId).in('id', piece);
    if (error) throw new Error(`FightBook fighters read failed: ${error.message}`);
    for (const row of (data ?? []) as unknown as Array<{ id: string }>) on.add(row.id);
  }
  return on;
}

/**
 * Of these profiles, those `me` may ask: on FightBook, not `me`, not blocked by `me` (and
 * declaring `weaponId`, when set).
 */
export async function askableFighters(
  db: Db,
  me: string,
  ids: string[],
  weaponId?: string,
): Promise<Set<string>> {
  const others = ids.filter((id) => id !== me);
  if (others.length === 0) return new Set();
  const [on, blocked] = await Promise.all([
    fightBookOnFighters(db, others, weaponId),
    blockedBy(db, me),
  ]);
  return new Set([...on].filter((id) => !blocked.has(id)));
}

/** The fighters `me` blocked. Names `me` as the blocker only: never the blocks naming `me`. */
export async function blockedBy(db: Db, me: string): Promise<Set<string>> {
  const { data, error } = await db
    .from('fightbook_blocks')
    .select('blocked_global_person_id')
    .eq('blocker_global_person_id', me);
  if (error) throw new Error(`FightBook blocks read failed: ${error.message}`);
  return new Set(
    ((data ?? []) as Array<{ blocked_global_person_id: string }>).map(
      (row) => row.blocked_global_person_id,
    ),
  );
}

/**
 * The fighters `me` hearted: one read, `me` as the owner only, at most `FAVOURITES_MAX` (the
 * PUT's cap, from `@myclash/types`: the web's "full" sentence says the same number), oldest
 * first so the same ones come back every time. Callers
 * must not assume fewer rows exist than the read returns. The WRITE side is bounded by the PUT's
 * count check (`FightBookFavouritesService.add`); two racing PUTs may land 201, and a fighter
 * merge moves favourites over (0268) and may push someone past the cap. Both are accepted: a
 * reader sees the first 200 and nothing breaks.
 */
export async function favouritesOf(db: Db, me: string): Promise<Set<string>> {
  const { data, error } = await db
    .from('fightbook_favourites')
    .select('favourite_global_person_id')
    .eq('owner_global_person_id', me)
    .order('created_at', { ascending: true })
    .limit(FAVOURITES_MAX);
  if (error) throw new Error(`FightBook favourites read failed: ${error.message}`);
  return new Set(
    ((data ?? []) as Array<{ favourite_global_person_id: string }>).map(
      (row) => row.favourite_global_person_id,
    ),
  );
}

/** Is `me` on this Event's roster (a `persons` row of theirs there)? */
export async function isOnEventRoster(db: Db, me: string, eventId: string): Promise<boolean> {
  const { data, error } = await db
    .from('persons')
    .select('id')
    .eq('event_id', eventId)
    .eq('global_person_id', me)
    .limit(1);
  if (error) throw new Error(`spar roster read failed: ${error.message}`);
  return (data ?? []).length > 0;
}
