import { ALREADY_OWNS_CLUB_CODE, SIGNUP_REFUSED_PARAM } from '@myclash/types';
import type { SupabaseService } from '../supabase/supabase.service';

/** The club an organizer sign-up ends in: the one it made, or one the account owned already. */
export interface SignupClub {
  slug: string;
  made: boolean;
}

/**
 * The page a sign-up sends its account to: its club. An account that owned a
 * club got no second one (operator ruling 369), and the club's page says so.
 */
export function clubPage(club: SignupClub): string {
  const page = `/org/${club.slug}`;
  return club.made ? page : `${page}?${SIGNUP_REFUSED_PARAM}=${ALREADY_OWNS_CLUB_CODE}`;
}

/**
 * The address of a club the account owns, or null: the one it has owned
 * longest when it owns several. A plain member of somebody's club owns none.
 *
 * It decides whether a club is made, so a failed read throws.
 */
export async function ownedClubSlug(
  supabase: SupabaseService,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase.service
    .from('organization_members')
    .select('organizations(slug)')
    .eq('user_id', userId)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`The clubs account ${userId} owns could not be read: ${error.message}`);
  }
  return (data as { organizations: { slug?: string } | null } | null)?.organizations?.slug ?? null;
}
