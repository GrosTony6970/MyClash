import { Injectable, NotFoundException } from '@nestjs/common';
import type { FightBookBlock } from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { readSparFighters, unknownSparFighter } from './spar-fighters';
import { databaseRefusal } from './spar-requests.service';

/**
 * Block and unblock in FightBook (slice 1). The blocked fighter is not told and sees nothing
 * change: their next request "sends" as any other and ends "Not this time" (`fightbook_ask`).
 * Blocking ends what waits between the two (`fightbook_block`, 0264); an agreed spar stays.
 * Only the blocker ever reads a block: these reads name the caller as the blocker.
 */
@Injectable()
export class FightBookBlocksService {
  constructor(private readonly supabase: SupabaseService) {}

  /** Block `blocked` as `me` (the caller's profile, never a body value). Twice is once. */
  async block(me: string, blocked: string): Promise<void> {
    const { error } = await this.supabase.service.rpc('fightbook_block', {
      p_blocker: me,
      p_blocked: blocked,
    });
    if (error?.code === 'P0002') throw new NotFoundException('Fighter not found');
    if (error) throw databaseRefusal(error, 'FightBook block');
  }

  /** The fighters I blocked, newest first. */
  async list(me: string): Promise<FightBookBlock[]> {
    const { data, error } = await this.supabase.service
      .from('fightbook_blocks')
      .select('blocked_global_person_id, created_at')
      .eq('blocker_global_person_id', me)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`FightBook blocks read failed: ${error.message}`);
    const ids = ((data ?? []) as Array<{ blocked_global_person_id: string }>).map(
      (row) => row.blocked_global_person_id,
    );
    const fighters = await readSparFighters(this.supabase.service, ids);
    return ids.map((id) => ({ fighter: fighters.get(id) ?? unknownSparFighter(id) }));
  }

  /** Remove my own block, if there is one. */
  async unblock(me: string, blocked: string): Promise<void> {
    const { error } = await this.supabase.service
      .from('fightbook_blocks')
      .delete()
      .eq('blocker_global_person_id', me)
      .eq('blocked_global_person_id', blocked);
    if (error) throw new Error(`FightBook unblock failed: ${error.message}`);
  }
}
