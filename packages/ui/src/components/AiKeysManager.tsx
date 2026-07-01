'use client';

import { useCallback, useEffect, useState } from 'react';
import { useConfirm } from './useConfirm';
import { Button } from './Button';
import { DataTable, DataTableCell, DataTableHead, DataTableRow } from './DataTable';
import { RowActionButton } from './RowActionButton';
import {
  AiKeyFormDialog,
  type AiKeyFormValues,
  type AiKeyModelOption,
  type AiKeyProvider,
} from './AiKeyFormDialog';

interface AiKeyItem {
  id: string;
  label: string;
  provider: AiKeyProvider;
  model: string | null;
  keyLast4: string | null;
  monthlyBudgetEur: number | null;
  spentMtdEur: number;
  isActive: boolean;
  updatedAt: string;
}

type ModelsMap = Record<AiKeyProvider, AiKeyModelOption[]>;

export interface AiKeysManagerProps {
  /** Absolute URL of the keys collection (e.g. `${apiUrl}/api/v1/admin/ai-keys`). */
  apiBase: string;
  /** Absolute URL of `GET /ai/models`. */
  modelsUrl: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** i18n namespace prefix; leaves live under `<ns>.keys.*`. */
  ns: string;
  /** Called after any successful mutation (so a parent can refresh usage/budget). */
  onChanged?: () => void;
}

const PROVIDER_LABELS: Record<AiKeyProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  mistral: 'Mistral',
  google: 'Google',
};

const EMPTY_MODELS: ModelsMap = { anthropic: [], openai: [], mistral: [], google: [] };

function eur(n: number): string {
  return `€${n.toFixed(2)}`;
}

/**
 * Self-contained multi-key manager: lists a scope's AI keys in one table
 * (masked key, per-key budget + month-to-date spend, active badge), with add /
 * edit / delete / set-active. Reused by the platform, org, and fighter pages —
 * they differ only by `apiBase` + i18n `ns`.
 */
export function AiKeysManager({ apiBase, modelsUrl, t, ns, onChanged }: AiKeysManagerProps) {
  const [keys, setKeys] = useState<AiKeyItem[]>([]);
  const [models, setModels] = useState<ModelsMap>(EMPTY_MODELS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; editing: AiKeyItem | null }>({
    open: false,
    editing: null,
  });
  const { confirm, confirmDialog } = useConfirm();

  const key = useCallback(
    (leaf: string, vars?: Record<string, string | number>) => t(`${ns}.keys.${leaf}`, vars),
    [t, ns],
  );

  const loadKeys = useCallback(async () => {
    const res = await fetch(apiBase, { credentials: 'include' });
    if (!res.ok) throw new Error(key('loadError'));
    setKeys((await res.json()) as AiKeyItem[]);
  }, [apiBase, key]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(modelsUrl, { credentials: 'include' })
        .then((r) => (r.ok ? (r.json() as Promise<ModelsMap>) : null))
        .catch(() => null),
      fetch(apiBase, { credentials: 'include' }).then((r) =>
        r.ok ? (r.json() as Promise<AiKeyItem[]>) : Promise.reject(new Error(key('loadError'))),
      ),
    ])
      .then(([modelData, keyData]) => {
        if (cancelled) return;
        if (modelData) setModels(modelData);
        setKeys(keyData);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : key('loadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, modelsUrl, key]);

  async function submitKey(values: AiKeyFormValues) {
    setBusy(true);
    setError(null);
    try {
      const editing = dialog.editing;
      const url = editing ? `${apiBase}/${editing.id}` : apiBase;
      const method = editing ? 'PATCH' : 'POST';
      const body: Record<string, unknown> = {
        label: values.label,
        provider: values.provider,
        model: values.model,
        monthlyBudgetEur: values.monthlyBudgetEur,
      };
      // Only send apiKey when set (blank in edit mode keeps the stored key).
      if (values.apiKey) body['apiKey'] = values.apiKey;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(key('saveError'));
      setDialog({ open: false, editing: null });
      await loadKeys();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : key('saveError'));
    } finally {
      setBusy(false);
    }
  }

  async function activate(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/${id}/activate`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(key('saveError'));
      setKeys((await res.json()) as AiKeyItem[]);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : key('saveError'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: AiKeyItem) {
    if (!(await confirm({ title: key('deleteConfirm', { label: item.label }), danger: true })))
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/${item.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok && res.status !== 204) throw new Error(key('saveError'));
      await loadKeys();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : key('saveError'));
    } finally {
      setBusy(false);
    }
  }

  function modelLabel(item: AiKeyItem): string {
    if (!item.model) return key('defaultModel');
    const opt = (models[item.provider] ?? []).find((m) => m.id === item.model);
    return opt?.label ?? item.model;
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">{key('title')}</h2>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={() => setDialog({ open: true, editing: null })}
        >
          {key('addKey')}
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : keys.length === 0 ? (
        <p className="rounded-md border border-border bg-background px-4 py-6 text-center text-sm text-muted">
          {key('empty')}
        </p>
      ) : (
        <DataTable>
          <DataTableHead>
            <DataTableCell as="th">{key('colLabel')}</DataTableCell>
            <DataTableCell as="th">{key('colProvider')}</DataTableCell>
            <DataTableCell as="th">{key('colModel')}</DataTableCell>
            <DataTableCell as="th">{key('colKey')}</DataTableCell>
            <DataTableCell as="th">{key('colBudget')}</DataTableCell>
            <DataTableCell as="th">{key('colSpent')}</DataTableCell>
            <DataTableCell as="th">{key('colActive')}</DataTableCell>
            <DataTableCell as="th" className="text-right">
              {key('colActions')}
            </DataTableCell>
          </DataTableHead>
          <tbody>
            {keys.map((item) => (
              <DataTableRow key={item.id}>
                <DataTableCell className="font-medium text-foreground">{item.label}</DataTableCell>
                <DataTableCell>{PROVIDER_LABELS[item.provider]}</DataTableCell>
                <DataTableCell>{modelLabel(item)}</DataTableCell>
                <DataTableCell mono>{`••••${item.keyLast4 ?? '••••'}`}</DataTableCell>
                <DataTableCell>
                  {item.monthlyBudgetEur == null ? key('unlimited') : eur(item.monthlyBudgetEur)}
                </DataTableCell>
                <DataTableCell>{eur(item.spentMtdEur)}</DataTableCell>
                <DataTableCell>
                  {item.isActive ? (
                    <span className="inline-flex items-center rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
                      {key('active')}
                    </span>
                  ) : (
                    <RowActionButton
                      variant="neutral"
                      disabled={busy}
                      onClick={() => void activate(item.id)}
                    >
                      {key('setActive')}
                    </RowActionButton>
                  )}
                </DataTableCell>
                <DataTableCell className="text-right">
                  <div className="inline-flex gap-1.5">
                    <RowActionButton
                      variant="edit"
                      disabled={busy}
                      onClick={() => setDialog({ open: true, editing: item })}
                    >
                      {key('edit')}
                    </RowActionButton>
                    <RowActionButton
                      variant="danger"
                      disabled={busy}
                      onClick={() => void remove(item)}
                    >
                      {key('delete')}
                    </RowActionButton>
                  </div>
                </DataTableCell>
              </DataTableRow>
            ))}
          </tbody>
        </DataTable>
      )}

      <AiKeyFormDialog
        open={dialog.open}
        mode={dialog.editing ? 'edit' : 'create'}
        models={models}
        t={t}
        ns={ns}
        busy={busy}
        initial={
          dialog.editing
            ? {
                label: dialog.editing.label,
                provider: dialog.editing.provider,
                model: dialog.editing.model,
                monthlyBudgetEur: dialog.editing.monthlyBudgetEur,
                keyLast4: dialog.editing.keyLast4,
              }
            : undefined
        }
        onSubmit={(values) => void submitKey(values)}
        onCancel={() => setDialog({ open: false, editing: null })}
      />
      {confirmDialog}
    </section>
  );
}
