import { ConflictException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A cancelled session does nothing (operator rulings 526-529): nobody books it, nobody is promoted
 * into it from its waitlist, it is not moved, and the pages show it struck through. Its status
 * alone can still change through the API.
 */

/** The refusal, named, so a page says it in the reader's language. */
export function sessionCancelledRefusal(): ConflictException {
  return new ConflictException({
    error: 'WorkshopSessionCancelled',
    message: 'This workshop session was cancelled.',
  });
}

/** Whether the session is cancelled. A read that fails throws: read as "not cancelled", a
 *  cancelled session would be moved or promoted into. */
export async function isSessionCancelled(db: SupabaseClient, sessionId: string): Promise<boolean> {
  const { data, error } = await db
    .from('workshop_sessions')
    .select('status')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw new Error(`Session ${sessionId} status not read: ${error.message}`);
  return (data as { status?: string | null } | null)?.status === 'cancelled';
}
