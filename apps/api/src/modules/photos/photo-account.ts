import { Logger } from '@nestjs/common';
import { PHOTO_ACCOUNT_NAME_MAX } from '@myclash/types';
import { readAccount } from '../auth/auth-server-calls';
import type { SupabaseService } from '../supabase/supabase.service';
import { photosUnavailable } from './photo-refusals';

const logger = new Logger('PhotoAccountName');

/** The 503 of a read that failed, its cause in the log: the page's sentence names no read. */
function unavailableBecause(cause: string) {
  logger.warn(`A photo's name: ${cause}`);
  return photosUnavailable();
}

/** Trimmed text, or null when it is not text or is blank. */
const named = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/**
 * The name a photo sent from a personal space carries (design Goal 11, ruling 458): the account's
 * fighter-profile name, else the name typed at sign-up, never the email; null when it has neither.
 * Cut at `PHOTO_ACCOUNT_NAME_MAX` characters (code points, as Postgres counts them).
 *
 * The photos' one owner of "this account's name". Two other readers exist
 * (`user-directory.service.ts`, `events.service.ts`): both put the given and family name first and
 * swallow a failed read. Here a failed read is a 503 (ruling 461): "no name" would refuse a person
 * who has one.
 */
export async function accountPhotoName(
  supabase: SupabaseService,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase.service
    .from('global_persons')
    .select('display_name')
    .eq('claimed_by_user_id', userId)
    .maybeSingle();
  if (error) throw unavailableBecause(`profile not read: ${error.message}`);
  const name =
    named((data as { display_name?: unknown } | null)?.display_name) ??
    (await signUpName(supabase, userId));
  return name === null ? null : [...name].slice(0, PHOTO_ACCOUNT_NAME_MAX).join('');
}

async function signUpName(supabase: SupabaseService, userId: string): Promise<string | null> {
  const answer = await readAccount(supabase.service, userId).catch((fault: unknown) => {
    throw unavailableBecause(
      `account not read: ${fault instanceof Error ? fault.message : String(fault)}`,
    );
  });
  if (answer.error) throw unavailableBecause(`account not read: ${answer.error.message}`);
  const metadata = (answer.data.user?.user_metadata ?? {}) as Record<string, unknown>;
  return named(metadata['display_name']);
}
