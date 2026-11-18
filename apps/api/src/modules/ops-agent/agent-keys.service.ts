import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { insertAuditLog } from '../../common/audit-log';
import { SupabaseService } from '../supabase/supabase.service';

/** One ops agent key as the console shows it: never its hash, never its account. */
export interface AgentKeyRow {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

type StoredRow = {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const COLUMNS = 'id, label, created_at, last_used_at, revoked_at';

function toRow(row: StoredRow): AgentKeyRow {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

/**
 * The console's view of the ops agent's keys (the ops agent's design, section 1: "the off switch").
 * The deploy seed is the one way a key is created; this service lists and revokes.
 */
@Injectable()
export class AgentKeysService {
  private readonly logger = new Logger(AgentKeysService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async list(): Promise<AgentKeyRow[]> {
    const { data, error } = await this.supabase.service
      .from('agent_keys')
      .select(COLUMNS)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`agent keys read failed: ${error.message}`);
    return ((data ?? []) as StoredRow[]).map(toRow);
  }

  /**
   * Revokes a live key. Two revokes at once: the `revoked_at is null` filter lets one of them
   * update the row; the other finds no live key and answers 404, so the audit log holds one row.
   */
  async revoke(id: string, actorUserId: string): Promise<AgentKeyRow> {
    const { data, error } = await this.supabase.service
      .from('agent_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .is('revoked_at', null)
      .select(COLUMNS)
      .maybeSingle();
    if (error) throw new Error(`agent key revoke failed: ${error.message}`);
    if (!data) throw new NotFoundException('No live agent key with this id');

    const audit = await insertAuditLog(this.supabase.service, {
      actorUserId,
      action: 'agent_key.revoke',
      entityType: 'agent_key',
      entityId: id,
    });
    if (audit.error) this.logger.warn(`Could not write audit log for agent_key.revoke on ${id}`);
    return toRow(data as StoredRow);
  }
}
