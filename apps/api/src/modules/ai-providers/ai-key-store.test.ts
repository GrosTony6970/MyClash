import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiKeyStore, type AiKeyScopeConfig } from './ai-key-store';
import { encryptAiKey } from './ai-key-crypto';

const AI_KEY_SECRET = 'b'.repeat(64);
const SECRET_BUF = Buffer.from(AI_KEY_SECRET, 'hex');

const ORG_SCOPE: AiKeyScopeConfig = {
  keyTable: 'organization_ai_keys',
  ownerColumn: 'organization_id',
  usageTable: 'ai_usage_log',
  usageKeyColumn: 'organization_ai_key_id',
  usageTimeColumn: 'called_at',
  setActiveFn: 'set_active_org_ai_key',
};

const rpcMock = vi.fn().mockResolvedValue({ error: null });
const fromMock = vi.fn();
const supabase = { service: { from: fromMock, rpc: rpcMock } };

// Records every insert/update/delete so tests can assert the payloads.
const ops: { table: string; op: string; arg: unknown }[] = [];
// Per-table FIFO of results the chains resolve to.
const queues: Record<string, unknown[]> = {};

function setQueue(map: Record<string, unknown[]>) {
  for (const k of Object.keys(queues)) delete queues[k];
  Object.assign(queues, map);
}

function chain(table: string, result: unknown) {
  const c: Record<string, unknown> = {};
  // `range` is chainable like the rest: the spend paths page and sum in JS now,
  // because PostgREST rejects `cost_eur.sum()` (see `common/pg-aggregate.ts`).
  for (const m of ['select', 'eq', 'in', 'gte', 'order', 'limit', 'range']) c[m] = vi.fn(() => c);
  for (const m of ['insert', 'update', 'upsert', 'delete']) {
    c[m] = vi.fn((arg: unknown) => {
      ops.push({ table, op: m, arg });
      return c;
    });
  }
  c['single'] = vi.fn().mockResolvedValue(result);
  c['maybeSingle'] = vi.fn().mockResolvedValue(result);
  c['then'] = (resolve: (v: unknown) => unknown) => resolve(result);
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockResolvedValue({ error: null });
  ops.length = 0;
  const idx: Record<string, number> = {};
  fromMock.mockImplementation((table: string) => {
    const arr = queues[table] ?? [];
    const i = idx[table] ?? 0;
    idx[table] = i + 1;
    return chain(table, arr[i] ?? { data: null, error: null });
  });
});

function store() {
  return new AiKeyStore(supabase as never, SECRET_BUF, ORG_SCOPE);
}

describe('AiKeyStore', () => {
  it('create encrypts the key, stores last-4, and auto-activates the first key', async () => {
    setQueue({
      organization_ai_keys: [
        { count: 0, error: null }, // count → first key
        { data: { id: 'k1' }, error: null }, // insert → id
        {
          data: [
            {
              id: 'k1',
              label: 'Prod',
              provider: 'anthropic',
              model: null,
              key_last4: '1234',
              monthly_budget_eur: null,
              is_active: true,
              updated_at: 't',
            },
          ],
          error: null,
        }, // list
      ],
      ai_usage_log: [{ data: [], error: null }],
    });

    const created = await store().create(
      'org-1',
      { label: 'Prod', provider: 'anthropic', apiKey: 'sk-secret-1234', model: null },
      'actor-1',
    );

    const insertOp = ops.find((o) => o.op === 'insert');
    const row = insertOp?.arg as Record<string, unknown>;
    expect(row['api_key_enc']).not.toContain('sk-secret-1234');
    expect(row['key_last4']).toBe('1234');
    expect(row['organization_id']).toBe('org-1');
    expect(row['updated_by_user_id']).toBe('actor-1');
    expect(row['is_active']).toBe(false); // activation happens via the SQL fn
    expect(rpcMock).toHaveBeenCalledWith('set_active_org_ai_key', { p_org: 'org-1', p_key: 'k1' });
    expect(created.id).toBe('k1');
  });

  it('create does not auto-activate when other keys already exist', async () => {
    setQueue({
      organization_ai_keys: [
        { count: 2, error: null },
        { data: { id: 'k2' }, error: null },
        { data: [{ id: 'k2', provider: 'openai', is_active: false }], error: null },
      ],
      ai_usage_log: [{ data: [], error: null }],
    });
    await store().create('org-1', { label: 'Second', provider: 'openai', apiKey: 'sk-abcdefghij' });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('resolveActiveKey decrypts the stored secret', async () => {
    const { ciphertext, iv } = encryptAiKey(SECRET_BUF, 'sk-live-secret');
    setQueue({
      organization_ai_keys: [
        {
          data: {
            id: 'k1',
            provider: 'anthropic',
            model: 'claude-sonnet-5',
            api_key_enc: ciphertext,
            api_key_iv: iv,
            monthly_budget_eur: 7,
          },
          error: null,
        },
      ],
    });
    const active = await store().resolveActiveKey('org-1');
    expect(active).toEqual({
      id: 'k1',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      apiKey: 'sk-live-secret',
      monthlyBudgetEur: 7,
    });
  });

  it('update re-encrypts only when a new apiKey is supplied', async () => {
    setQueue({
      organization_ai_keys: [
        { error: null }, // update
        { data: [{ id: 'k1', provider: 'anthropic', is_active: true }], error: null }, // list
      ],
      ai_usage_log: [{ data: [], error: null }],
    });
    await store().update('org-1', 'k1', { label: 'Renamed' });
    const updateOp = ops.find((o) => o.op === 'update');
    const patch = updateOp?.arg as Record<string, unknown>;
    expect(patch['label']).toBe('Renamed');
    expect(patch).not.toHaveProperty('api_key_enc');
  });

  it('update encrypts a replacement key and refreshes last-4', async () => {
    setQueue({
      organization_ai_keys: [
        { error: null },
        { data: [{ id: 'k1', provider: 'anthropic', is_active: true }], error: null },
      ],
      ai_usage_log: [{ data: [], error: null }],
    });
    await store().update('org-1', 'k1', { apiKey: 'sk-rotated-key-5678' });
    const patch = ops.find((o) => o.op === 'update')?.arg as Record<string, unknown>;
    expect(patch['api_key_enc']).toBeTruthy();
    expect(patch['api_key_enc']).not.toContain('sk-rotated-key-5678');
    expect(patch['key_last4']).toBe('5678');
  });

  it('keyMonthlySpend sums the month rows in JS', async () => {
    // Rows, not a server-side aggregate: PostgREST rejects `cost_eur.sum()`
    // unless `db-aggregates-enabled` is on, and it is off by default. NUMERIC
    // arrives as a string, so the parse is part of what is under test.
    setQueue({
      ai_usage_log: [{ data: [{ cost_eur: '4.00' }, { cost_eur: '0.25' }], error: null }],
    });
    await expect(store().keyMonthlySpend('k1')).resolves.toBe(4.25);
  });

  it('keyMonthlySpend surfaces a query error instead of reporting zero spend', async () => {
    // The regression this whole change exists for. Every one of these call
    // sites used to drop `error` and return 0, so a rejected aggregate query
    // read as "nothing spent" and every budget and cap silently never fired.
    setQueue({ ai_usage_log: [{ data: null, error: { message: 'aggregates not enabled' } }] });
    await expect(store().keyMonthlySpend('k1')).rejects.toThrow('aggregates not enabled');
  });

  it('activate calls the scope set-active function', async () => {
    await store().activate('org-1', 'k9');
    expect(rpcMock).toHaveBeenCalledWith('set_active_org_ai_key', { p_org: 'org-1', p_key: 'k9' });
  });
});
