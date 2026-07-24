import type { SupabaseService } from '../../supabase/supabase.service';

interface DbStatsPayload {
  maxConnections: number;
  connectionsByState: { active: number; idle: number; idleInTransaction: number; total: number };
  longestQuerySeconds: number;
  databaseSizeBytes: number;
  cacheHitRatio: number;
  uptimeSeconds: number;
}

export async function collectDb(supabase: SupabaseService): Promise<DbStatsPayload> {
  const { data, error } = await supabase.service.rpc('admin_runtime_db_stats');
  if (error) throw new Error(error.message);
  if (!data) throw new Error('admin_runtime_db_stats returned no data');
  return data as DbStatsPayload;
}
