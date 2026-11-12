import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FAVOURITES_MAX, type FindCard, type SparRefusalCode } from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { askableFighters, favouritesOf, fightBookOnFighters } from './spar-askable';
import { readSparFighters } from './spar-fighters';
import { byName, SparFindService } from './spar-find.service';

/**
 * Favourites in FightBook (ruling 679): a private heart on any FightBook user. Nobody is told,
 * and nobody reads who hearted them: every read here names the caller as the owner.
 */
@Injectable()
export class FightBookFavouritesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly find: SparFindService,
  ) {}

  /**
   * Heart `id` as `me`. 404 unless `id` is a live, claimed profile with FightBook on, and not
   * `me`. 409 `favourites_full` at `FAVOURITES_MAX`, unless `id` is already one of them (a
   * second tap is 204, not a refusal). Count, then insert: two racing PUTs may land 201, and a
   * merge may exceed the cap (`favouritesOf`). Accepted.
   */
  async add(me: string, id: string): Promise<void> {
    const db = this.supabase.service;
    if (id === me || !(await fightBookOnFighters(db, [id])).has(id)) {
      throw new NotFoundException('Fighter not found');
    }
    const mine = await favouritesOf(db, me);
    if (mine.size >= FAVOURITES_MAX && !mine.has(id)) {
      throw new ConflictException({
        code: 'favourites_full' satisfies SparRefusalCode,
        message: 'The favourites list is full',
      });
    }
    const { error } = await db.from('fightbook_favourites').upsert(
      { owner_global_person_id: me, favourite_global_person_id: id },
      {
        onConflict: 'owner_global_person_id,favourite_global_person_id',
        ignoreDuplicates: true,
      },
    );
    if (error) throw new Error(`FightBook favourite write failed: ${error.message}`);
  }

  /** Remove my own heart on `id`, if there is one. Twice is once. */
  async remove(me: string, id: string): Promise<void> {
    const { error } = await this.supabase.service
      .from('fightbook_favourites')
      .delete()
      .eq('owner_global_person_id', me)
      .eq('favourite_global_person_id', id);
    if (error) throw new Error(`FightBook favourite delete failed: ${error.message}`);
  }

  /**
   * My favourites as Find cards, by name, at most `FAVOURITES_MAX` (the read stops there). Only
   * those `me` may still ask (`askableFighters`): on FightBook, live, not blocked by me. One who
   * blocked ME stays listed (ruling 672: nothing here reads who blocked the caller).
   */
  async list(me: string): Promise<FindCard[]> {
    const db = this.supabase.service;
    const favourites = await favouritesOf(db, me);
    const askable = await askableFighters(db, me, [...favourites]);
    const fighters = await readSparFighters(db, [...askable]);
    return this.find.withWeapons([...fighters.values()].sort(byName), favourites);
  }
}
