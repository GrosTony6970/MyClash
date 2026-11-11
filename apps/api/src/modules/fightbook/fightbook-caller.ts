import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyRequest } from 'fastify';
import type { SparRefusalCode } from '@myclash/types';
import { getIdentity } from '../../common/auth/identity';
import { applyReachable } from '../fighters/directory-predicate';

/** Who calls a FightBook route: the account, its live fighter profile, and the switch. */
export interface FightBookCaller {
  userId: string;
  /** Null when the account holds no live profile: FightBook needs one (the design). */
  globalPersonId: string | null;
  enabled: boolean;
}

/** A FightBook refusal: 403 with its `code`, which the web turns into a sentence. */
export const refusal = (code: SparRefusalCode, message: string) =>
  new ForbiddenException({ code, message });

/**
 * The caller of a `me/fightbook` route. 401 signed out; 403 a staff login or a guest token, as
 * `FightersController.list` (FightBook belongs to a personal account). The profile is the one the
 * account claims, if it is live: not merged away, not deleted, account not erased
 * (`applyReachable`). The account holds at most one (0063).
 */
export async function fightBookCaller(
  req: FastifyRequest,
  db: Pick<SupabaseClient, 'from'>,
): Promise<FightBookCaller> {
  const identity = getIdentity(req);
  if (identity.kind === 'anonymous') throw new UnauthorizedException('Authentication required');
  if (identity.kind !== 'claimed') {
    throw new ForbiddenException('A personal account is required');
  }
  const { data, error } = await applyReachable(
    db.from('global_persons').select('id, fightbook_enabled'),
  )
    .eq('claimed_by_user_id', identity.userId)
    .maybeSingle();
  if (error) throw new Error(`FightBook profile read failed: ${error.message}`);
  const row = data as { id: string; fightbook_enabled: boolean } | null;
  return {
    userId: identity.userId,
    globalPersonId: row?.id ?? null,
    enabled: row?.fightbook_enabled === true,
  };
}

/** The caller's live profile, or 403 `no_profile`. */
export function requireProfile(caller: FightBookCaller): string {
  if (!caller.globalPersonId) {
    throw refusal('no_profile', 'FightBook needs a fighter profile');
  }
  return caller.globalPersonId;
}

/** The caller's live profile with FightBook on, or 403 `no_profile` / `fightbook_off`. */
export function requireFightBookOn(caller: FightBookCaller): string {
  const profile = requireProfile(caller);
  if (!caller.enabled) throw refusal('fightbook_off', 'FightBook is switched off');
  return profile;
}
