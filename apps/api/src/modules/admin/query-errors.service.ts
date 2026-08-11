import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Silencing a tripped query.
 *
 * Resolving is not deletion: the row keeps its counts and its history, and
 * `record_query_error` clears `resolved_at` the moment the same fingerprint
 * fires again. So silence is scoped to "this defect, as it stands now" and has
 * to be re-earned rather than being permanent.
 */
@Injectable()
export class AdminQueryErrorsService {
  constructor(private readonly supabase: SupabaseService) {}

  async resolve(id: string): Promise<{ id: string; resolvedAt: string }> {
    const resolvedAt = new Date().toISOString();

    const { data, error } = await this.supabase.service
      .from('query_error_events')
      .update({ resolved_at: resolvedAt })
      .eq('id', id)
      .is('resolved_at', null)
      .select('id')
      .maybeSingle();

    if (error) throw new Error(error.message);
    // Either the id is unknown or it was already resolved. Both mean "there is
    // nothing here to silence", and neither is worth distinguishing to a caller.
    if (!data) throw new NotFoundException('Query error not found or already resolved');

    return { id, resolvedAt };
  }
}
