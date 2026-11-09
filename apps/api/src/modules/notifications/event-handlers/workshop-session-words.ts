import type { SupabaseService } from '../../supabase/supabase.service';
import type { PerLanguage } from '../notice-texts/notice-texts';
import { sessionWhen } from '../notice-texts/session-when';

/**
 * What a Workshop notice says of its session: the Workshop's title and the session's start. A
 * Workshop may run more than once, so the start says which run. A read that fails gives neither.
 */
export async function workshopSessionWords(
  supabase: SupabaseService,
  sessionId: string,
): Promise<{ title: string | null; when: PerLanguage | null }> {
  const { data } = await supabase.service
    .from('workshop_sessions')
    .select('id, starts_at, workshops ( title, events ( timezone ) )')
    .eq('id', sessionId)
    .maybeSingle();
  const session = data as {
    starts_at?: string | null;
    workshops?: { title?: string | null; events?: { timezone?: string | null } | null } | null;
  } | null;
  return {
    title: session?.workshops?.title ?? null,
    when: sessionWhen(session?.starts_at, session?.workshops?.events?.timezone),
  };
}
