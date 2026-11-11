import { Injectable } from '@nestjs/common';
import type { FightBookSettings } from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { requireProfile, type FightBookCaller } from './fightbook-caller';

/**
 * The FightBook switch on the caller's own fighter profile (`global_persons.fightbook_enabled`,
 * off by default, 0263). Off means nobody may ask them and they may ask nobody.
 */
@Injectable()
export class FightBookSettingsService {
  constructor(private readonly supabase: SupabaseService) {}

  /** What the caller's read already holds: no second read. */
  get(caller: FightBookCaller): FightBookSettings {
    return { hasProfile: caller.globalPersonId !== null, enabled: caller.enabled };
  }

  /**
   * Save the switch and answer what was saved. Off also takes back the caller's own requests
   * still open, on EVERY save that says off: when that second write fails the switch is already
   * off (a 5xx), and the next save that says off finishes it. A request past its end is left as
   * it is: it is already a "Not this time", and withdrawing it would free its asker from the
   * no-asking-twice rule.
   */
  async set(caller: FightBookCaller, enabled: boolean): Promise<FightBookSettings> {
    const profile = requireProfile(caller);
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .update({ fightbook_enabled: enabled })
      .eq('id', profile)
      .select('fightbook_enabled')
      .maybeSingle();
    if (error) throw new Error(`FightBook switch write failed: ${error.message}`);
    const saved = (data as { fightbook_enabled: boolean } | null)?.fightbook_enabled === true;

    if (!enabled) {
      const { error: withdrawError } = await this.supabase.service
        .from('spar_requests')
        .update({ status: 'withdrawn' })
        .eq('asker_global_person_id', profile)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString());
      if (withdrawError) {
        throw new Error(`FightBook is off, but its open requests stay: ${withdrawError.message}`);
      }
    }
    return { hasProfile: true, enabled: saved };
  }
}
