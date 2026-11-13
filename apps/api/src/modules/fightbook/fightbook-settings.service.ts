import { Injectable } from '@nestjs/common';
import type { FightBookSettings } from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { requireProfile, type FightBookCaller } from './fightbook-caller';
import { readOwnSparLine } from './spar-public-line';

/** What a save may change. At least one key is set (the route's schema holds that). */
export interface FightBookSettingsPatch {
  enabled?: boolean;
  showStars?: boolean;
  /** 1 to 20 sets the limit, null removes it, a missing key leaves it. */
  dailyLimit?: number | null;
}

/**
 * The FightBook switches on the caller's own fighter profile: `global_persons.fightbook_enabled`
 * (off by default, 0263; off means nobody may ask them and they may ask nobody) and
 * `fightbook_show_stars` (off by default, 0267; whether the public page shows their stars).
 */
@Injectable()
export class FightBookSettingsService {
  constructor(private readonly supabase: SupabaseService) {}

  /** The caller's switches and their own line (spars done, stars): the stars show here whatever the switch. */
  async get(caller: FightBookCaller): Promise<FightBookSettings> {
    const me = caller.globalPersonId;
    if (me === null) return emptySettings(false, false);
    return this.answer(me, caller.enabled, await this.readShowStars(me));
  }

  private async readShowStars(me: string): Promise<boolean> {
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('fightbook_show_stars')
      .eq('id', me)
      .maybeSingle();
    if (error) throw new Error(`FightBook stars switch read failed: ${error.message}`);
    return (data as { fightbook_show_stars: boolean } | null)?.fightbook_show_stars === true;
  }

  /**
   * Save the switches and answer what was saved. Off also takes back the caller's own requests
   * still open, on EVERY save that says off: when that second write fails the switch is already
   * off (a 5xx), and the next save that says off finishes it. A request past its end is left as
   * it is: it is already a "Not this time", and withdrawing it would free its asker from the
   * no-asking-twice rule. Only the caller's own row is written; a key left out is left as it is.
   */
  async set(caller: FightBookCaller, patch: FightBookSettingsPatch): Promise<FightBookSettings> {
    const profile = requireProfile(caller);
    const saved = await this.saveSwitches(profile, patch);
    await this.saveLimit(profile, patch.dailyLimit);

    if (patch.enabled === false) {
      const { error: withdrawError } = await this.supabase.service
        .from('spar_requests')
        .update({ status: 'withdrawn' })
        .eq('asker_global_person_id', profile)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString());
      if (withdrawError) {
        throw new Error(`FightBook is off, but its open requests stay: ${withdrawError.message}`);
      }
      await this.clearFloorTools(profile);
    }
    return this.answer(
      profile,
      saved?.fightbook_enabled === true,
      saved?.fightbook_show_stars === true,
    );
  }

  /**
   * Write the switch keys the patch sets and answer the stored row. A limit-only save has no
   * switch to write, so it READS the row instead: the answer is built from it, and a skipped
   * update would answer `enabled: false`, which the panel takes as the truth.
   */
  private async saveSwitches(profile: string, patch: FightBookSettingsPatch) {
    const row: Record<string, boolean> = {};
    if (patch.enabled !== undefined) row['fightbook_enabled'] = patch.enabled;
    if (patch.showStars !== undefined) row['fightbook_show_stars'] = patch.showStars;
    const columns = 'fightbook_enabled, fightbook_show_stars';
    const table = this.supabase.service.from('global_persons');
    const query =
      Object.keys(row).length > 0
        ? table.update(row).eq('id', profile).select(columns)
        : table.select(columns).eq('id', profile);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`FightBook switch write failed: ${error.message}`);
    return data as { fightbook_enabled: boolean; fightbook_show_stars: boolean } | null;
  }

  /**
   * A number upserts the caller's own row (the column names the conflict; `updated_at` moves on
   * every write), null deletes it, a missing key leaves it. The limit lives in a deny-all table
   * of its own: never on `global_persons`, which a listed fighter's profile page reads.
   */
  private async saveLimit(profile: string, limit: number | null | undefined): Promise<void> {
    if (limit === undefined) return;
    const table = this.supabase.service.from('fightbook_daily_limits');
    const { error } =
      limit === null
        ? await table.delete().eq('global_person_id', profile)
        : await table.upsert(
            {
              global_person_id: profile,
              daily_limit: limit,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'global_person_id' },
          );
    if (error) throw new Error(`FightBook daily limit write failed: ${error.message}`);
  }

  private async readLimit(me: string): Promise<number | null> {
    const { data, error } = await this.supabase.service
      .from('fightbook_daily_limits')
      .select('daily_limit')
      .eq('global_person_id', me)
      .maybeSingle();
    if (error) throw new Error(`FightBook daily limit read failed: ${error.message}`);
    return (data as { daily_limit: number } | null)?.daily_limit ?? null;
  }

  /**
   * Off also takes the caller off the floor: their free-now row, QR codes and answers go, and
   * their OPEN calls close (an open call holds no pick, so the status-shape check allows it).
   * Each write is scoped to the caller's profile. As the withdrawal above: a failure throws after
   * the switch is already off, and the next save that says off finishes it. Meanwhile every floor
   * read filters through `applyFightBookOn`, so a half-finished switch-off still hides the fighter.
   */
  private async clearFloorTools(profile: string): Promise<void> {
    const db = this.supabase.service;
    const failed = (step: string, message: string) =>
      new Error(`FightBook is off, but ${step}: ${message}`);
    const free = await db.from('fightbook_free_now').delete().eq('global_person_id', profile);
    if (free.error) throw failed('its free-now mark stays', free.error.message);
    const codes = await db.from('fightbook_qr_codes').delete().eq('global_person_id', profile);
    if (codes.error) throw failed('its QR codes stay', codes.error.message);
    const answers = await db
      .from('spar_open_call_answers')
      .delete()
      .eq('answerer_global_person_id', profile);
    if (answers.error) throw failed('its open-call answers stay', answers.error.message);
    const calls = await db
      .from('spar_open_calls')
      .update({ status: 'closed' })
      .eq('poster_global_person_id', profile)
      .eq('status', 'open');
    if (calls.error) throw failed('its open calls stay', calls.error.message);
  }

  private async answer(me: string, enabled: boolean, showStars: boolean) {
    const dailyLimit = await this.readLimit(me);
    const own = await readOwnSparLine(this.supabase.service, me);
    return { hasProfile: true, enabled, showStars, dailyLimit, ...own };
  }
}

function emptySettings(enabled: boolean, showStars: boolean): FightBookSettings {
  return { hasProfile: false, enabled, showStars, dailyLimit: null, sparred: 0, stars: null };
}
