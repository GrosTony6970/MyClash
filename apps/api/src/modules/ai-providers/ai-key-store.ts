import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { SupabaseService } from '../supabase/supabase.service';
import type { AIProvider } from './adapters/provider-adapter.interface';
import { decryptAiKey, encryptAiKey } from './ai-key-crypto';
import { isValidModelForProvider } from './model-registry';

/**
 * Describes one AI-key scope so a single store implementation serves platform,
 * organization, and fighter keys. Each scope differs only by table names, the
 * owner column, and where usage is metered.
 */
export interface AiKeyScopeConfig {
  keyTable: 'platform_ai_keys' | 'organization_ai_keys' | 'fighter_ai_keys';
  /** null for the platform scope (single owner-less set). */
  ownerColumn: 'organization_id' | 'global_person_id' | null;
  usageTable: 'ai_usage_log' | 'platform_ai_usage_log' | 'fighter_ai_usage_log';
  usageKeyColumn: 'organization_ai_key_id' | 'platform_ai_key_id' | 'fighter_ai_key_id';
  usageTimeColumn: 'called_at' | 'created_at';
  setActiveFn: 'set_active_platform_ai_key' | 'set_active_org_ai_key' | 'set_active_fighter_ai_key';
}

/** Masked list item — never carries the secret; only the last 4 chars. */
export interface AiKeyListItem {
  id: string;
  label: string;
  provider: AIProvider;
  model: string | null;
  keyLast4: string | null;
  monthlyBudgetEur: number | null;
  spentMtdEur: number;
  isActive: boolean;
  updatedAt: string;
}

/** Decrypted active key + its per-key budget, for the generate path. */
export interface ResolvedActiveKey {
  id: string;
  provider: AIProvider;
  model: string | null;
  apiKey: string;
  monthlyBudgetEur: number | null;
}

export interface CreateKeyInput {
  label: string;
  provider: AIProvider;
  model?: string | null;
  apiKey: string;
  monthlyBudgetEur?: number | null;
  isActive?: boolean;
}

export interface UpdateKeyInput {
  label?: string;
  provider?: AIProvider;
  model?: string | null;
  apiKey?: string;
  monthlyBudgetEur?: number | null;
}

interface KeyRow {
  id: string;
  label: string;
  provider: AIProvider;
  model: string | null;
  key_last4: string | null;
  monthly_budget_eur: number | string | null;
  is_active: boolean;
  updated_at: string;
}

/**
 * CRUD + active-key resolution + per-key spend for one AI-key scope. Runs
 * entirely on the service role (RLS is defense-in-depth; the secret never
 * leaves the server). The "one active key" invariant is enforced by a partial
 * unique index in SQL and toggled atomically via the scope's set-active fn.
 */
export class AiKeyStore {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly secretKey: Buffer,
    private readonly cfg: AiKeyScopeConfig,
  ) {}

  private ownerEq<T>(query: T, ownerId: string | null): T {
    if (this.cfg.ownerColumn && ownerId) {
      return (query as { eq: (c: string, v: string) => T }).eq(this.cfg.ownerColumn, ownerId);
    }
    return query;
  }

  async list(ownerId: string | null): Promise<AiKeyListItem[]> {
    let query = this.supabase.service
      .from(this.cfg.keyTable)
      .select('id, label, provider, model, key_last4, monthly_budget_eur, is_active, updated_at')
      .order('created_at', { ascending: true });
    query = this.ownerEq(query, ownerId);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as KeyRow[];
    const spend = await this.keySpendThisMonth(rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      provider: r.provider,
      model: r.model ?? null,
      keyLast4: r.key_last4 ?? null,
      monthlyBudgetEur: numOrNull(r.monthly_budget_eur),
      spentMtdEur: spend.get(r.id) ?? 0,
      isActive: r.is_active,
      updatedAt: r.updated_at,
    }));
  }

  async count(ownerId: string | null): Promise<number> {
    let query = this.supabase.service
      .from(this.cfg.keyTable)
      .select('id', { count: 'exact', head: true });
    query = this.ownerEq(query, ownerId);
    const { count, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return count ?? 0;
  }

  async create(
    ownerId: string | null,
    input: CreateKeyInput,
    actorUserId?: string | null,
  ): Promise<AiKeyListItem> {
    if (input.model != null && !isValidModelForProvider(input.provider, input.model)) {
      throw new BadRequestException(
        `Unknown model "${input.model}" for provider "${input.provider}"`,
      );
    }
    const { ciphertext, iv } = encryptAiKey(this.secretKey, input.apiKey);
    const shouldActivate = input.isActive || (await this.count(ownerId)) === 0;

    const row: Record<string, unknown> = {
      label: input.label,
      provider: input.provider,
      model: input.model ?? null,
      api_key_enc: ciphertext,
      api_key_iv: iv,
      key_last4: input.apiKey.slice(-4),
      monthly_budget_eur: input.monthlyBudgetEur ?? null,
      is_active: false, // activate via the atomic fn below to hold the invariant
    };
    if (this.cfg.ownerColumn && ownerId) row[this.cfg.ownerColumn] = ownerId;
    if (actorUserId) row['updated_by_user_id'] = actorUserId;

    const { data, error } = await this.supabase.service
      .from(this.cfg.keyTable)
      .insert(row)
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    const id = (data as { id: string }).id;
    if (shouldActivate) await this.activate(ownerId, id);

    const found = (await this.list(ownerId)).find((k) => k.id === id);
    if (!found) throw new NotFoundException('Key not found after create');
    return found;
  }

  async update(ownerId: string | null, id: string, input: UpdateKeyInput): Promise<AiKeyListItem> {
    const provider = input.provider;
    // If a model is supplied we validate against the effective provider (new one
    // if changing, else the stored one).
    if (input.model != null) {
      const effectiveProvider = provider ?? (await this.getProvider(ownerId, id));
      if (!isValidModelForProvider(effectiveProvider, input.model)) {
        throw new BadRequestException(
          `Unknown model "${input.model}" for provider "${effectiveProvider}"`,
        );
      }
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.label !== undefined) patch['label'] = input.label;
    if (input.provider !== undefined) patch['provider'] = input.provider;
    if (input.model !== undefined) patch['model'] = input.model;
    if (input.monthlyBudgetEur !== undefined) patch['monthly_budget_eur'] = input.monthlyBudgetEur;
    if (input.apiKey) {
      const { ciphertext, iv } = encryptAiKey(this.secretKey, input.apiKey);
      patch['api_key_enc'] = ciphertext;
      patch['api_key_iv'] = iv;
      patch['key_last4'] = input.apiKey.slice(-4);
    }

    let query = this.supabase.service.from(this.cfg.keyTable).update(patch).eq('id', id);
    query = this.ownerEq(query, ownerId);
    const { error } = await query;
    if (error) throw new BadRequestException(error.message);

    const found = (await this.list(ownerId)).find((k) => k.id === id);
    if (!found) throw new NotFoundException('Key not found');
    return found;
  }

  /**
   * Delete a key. If it was the active one, promote the most recently updated
   * remaining key so the scope keeps a usable key when possible.
   */
  async delete(ownerId: string | null, id: string): Promise<void> {
    const wasActive = await this.isActive(ownerId, id);
    let del = this.supabase.service.from(this.cfg.keyTable).delete().eq('id', id);
    del = this.ownerEq(del, ownerId);
    const { error } = await del;
    if (error) throw new BadRequestException(error.message);
    if (!wasActive) return;

    let q = this.supabase.service
      .from(this.cfg.keyTable)
      .select('id')
      .order('updated_at', { ascending: false })
      .limit(1);
    q = this.ownerEq(q, ownerId);
    const { data } = await q.maybeSingle();
    const next = (data as { id: string } | null)?.id;
    if (next) await this.activate(ownerId, next);
  }

  async activate(ownerId: string | null, id: string): Promise<void> {
    const args: Record<string, unknown> =
      this.cfg.setActiveFn === 'set_active_platform_ai_key'
        ? { p_key: id }
        : this.cfg.setActiveFn === 'set_active_org_ai_key'
          ? { p_org: ownerId, p_key: id }
          : { p_gpid: ownerId, p_key: id };
    const { error } = await this.supabase.service.rpc(this.cfg.setActiveFn, args);
    if (error) throw new BadRequestException(error.message);
  }

  async hasActiveKey(ownerId: string | null): Promise<boolean> {
    let query = this.supabase.service
      .from(this.cfg.keyTable)
      .select('id')
      .eq('is_active', true)
      .limit(1);
    query = this.ownerEq(query, ownerId);
    const { data } = await query.maybeSingle();
    return Boolean(data);
  }

  /** Decrypt the active key for the generate path (null if none configured). */
  async resolveActiveKey(ownerId: string | null): Promise<ResolvedActiveKey | null> {
    let query = this.supabase.service
      .from(this.cfg.keyTable)
      .select('id, provider, model, api_key_enc, api_key_iv, monthly_budget_eur')
      .eq('is_active', true);
    query = this.ownerEq(query, ownerId);
    const { data } = await query.maybeSingle();
    return this.rowToResolved(data);
  }

  /** Decrypt a specific key by id (e.g. for a per-key model-sync probe). */
  async resolveKeyById(ownerId: string | null, id: string): Promise<ResolvedActiveKey | null> {
    let query = this.supabase.service
      .from(this.cfg.keyTable)
      .select('id, provider, model, api_key_enc, api_key_iv, monthly_budget_eur')
      .eq('id', id);
    query = this.ownerEq(query, ownerId);
    const { data } = await query.maybeSingle();
    return this.rowToResolved(data);
  }

  private rowToResolved(data: unknown): ResolvedActiveKey | null {
    if (!data) return null;
    const row = data as {
      id: string;
      provider: AIProvider;
      model: string | null;
      api_key_enc: string;
      api_key_iv: string;
      monthly_budget_eur: number | string | null;
    };
    return {
      id: row.id,
      provider: row.provider,
      model: row.model ?? null,
      apiKey: decryptAiKey(this.secretKey, row.api_key_enc, row.api_key_iv),
      monthlyBudgetEur: numOrNull(row.monthly_budget_eur),
    };
  }

  /** Sum of a single key's cost for the current UTC calendar month. */
  async keyMonthlySpend(keyId: string): Promise<number> {
    const { data } = await this.supabase.service
      .from(this.cfg.usageTable)
      .select('sum:cost_eur.sum()')
      .eq(this.cfg.usageKeyColumn, keyId)
      .gte(this.cfg.usageTimeColumn, currentMonthStartIso())
      .single();
    return parseFloat((data as { sum: string | null } | null)?.sum ?? '0');
  }

  /** Per-key month-to-date spend for a set of key ids (for the list view). */
  private async keySpendThisMonth(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const { data } = await this.supabase.service
      .from(this.cfg.usageTable)
      .select(`${this.cfg.usageKeyColumn}, total:cost_eur.sum()`)
      .in(this.cfg.usageKeyColumn, ids)
      .gte(this.cfg.usageTimeColumn, currentMonthStartIso());
    const map = new Map<string, number>();
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const key = r[this.cfg.usageKeyColumn] as string | null;
      if (key) map.set(key, parseFloat((r['total'] as string | null) ?? '0'));
    }
    return map;
  }

  private async isActive(ownerId: string | null, id: string): Promise<boolean> {
    let query = this.supabase.service.from(this.cfg.keyTable).select('is_active').eq('id', id);
    query = this.ownerEq(query, ownerId);
    const { data } = await query.maybeSingle();
    return Boolean((data as { is_active?: boolean } | null)?.is_active);
  }

  private async getProvider(ownerId: string | null, id: string): Promise<AIProvider> {
    let query = this.supabase.service.from(this.cfg.keyTable).select('provider').eq('id', id);
    query = this.ownerEq(query, ownerId);
    const { data } = await query.maybeSingle();
    const provider = (data as { provider?: AIProvider } | null)?.provider;
    if (!provider) throw new NotFoundException('Key not found');
    return provider;
  }
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function currentMonthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
