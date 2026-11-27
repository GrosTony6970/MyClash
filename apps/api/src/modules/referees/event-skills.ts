import type { SupabaseClient } from '@supabase/supabase-js';

/** A referee role: a `referee_skills` row, global (`event_id` null) or the Event's own. */
export interface RefereeSkill {
  id: string;
  name: string;
}

/** The Event's roles (call P), also a draft's role names (call U). A failed read throws. */
export async function eventSkills(db: SupabaseClient, eventId: string): Promise<RefereeSkill[]> {
  const { data, error } = await db
    .from('referee_skills')
    .select('id, name, event_id')
    .or(`event_id.is.null,event_id.eq.${eventId}`);
  if (error) throw new Error(`referee skills read failed: ${error.message}`);
  return ((data ?? []) as { id: string; name: string }[]).map(({ id, name }) => ({ id, name }));
}
