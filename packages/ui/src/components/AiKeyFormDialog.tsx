'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { Button } from './Button';

export type AiKeyProvider = 'anthropic' | 'openai' | 'mistral' | 'google';

export interface AiKeyModelOption {
  id: string;
  label: string;
  isDefault: boolean;
  recommendedForToolUse: boolean;
  supportsTemperature: boolean;
}

export interface AiKeyFormValues {
  label: string;
  provider: AiKeyProvider;
  model: string | null;
  /** Empty string in edit mode means "keep the current key". */
  apiKey: string;
  monthlyBudgetEur: number | null;
}

export interface AiKeyFormInitial {
  label: string;
  provider: AiKeyProvider;
  model: string | null;
  monthlyBudgetEur: number | null;
  keyLast4: string | null;
}

export interface AiKeyFormDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  models: Record<AiKeyProvider, AiKeyModelOption[]>;
  /** i18n translator + namespace prefix (e.g. "admin.aiSettings"). Leaves live under `<ns>.keys.*`. */
  t: (key: string, vars?: Record<string, string | number>) => string;
  ns: string;
  initial?: AiKeyFormInitial;
  busy?: boolean;
  onSubmit: (values: AiKeyFormValues) => void;
  onCancel: () => void;
}

const PROVIDERS: AiKeyProvider[] = ['anthropic', 'openai', 'mistral', 'google'];
const PROVIDER_LABELS: Record<AiKeyProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  mistral: 'Mistral',
  google: 'Google',
};

function defaultModelId(options: AiKeyModelOption[]): string {
  return options.find((m) => m.isDefault)?.id ?? options[0]?.id ?? '';
}

/**
 * Add / edit dialog for a single AI provider key. Controlled by the parent
 * (open + busy). Focus-trapped modal mirroring PromptDialog. Tokenized so it
 * themes correctly in both web-admin and web-public.
 */
export function AiKeyFormDialog({
  open,
  mode,
  models,
  t,
  ns,
  initial,
  busy = false,
  onSubmit,
  onCancel,
}: AiKeyFormDialogProps) {
  const dialogRef = useRef<HTMLFormElement>(null);
  const [label, setLabel] = useState('');
  const [provider, setProvider] = useState<AiKeyProvider>('anthropic');
  const [model, setModel] = useState<string>('');
  const [apiKey, setApiKey] = useState('');
  const [budget, setBudget] = useState('');

  useFocusTrap(open, dialogRef);

  useEffect(() => {
    if (!open) return;
    setLabel(initial?.label ?? '');
    const p = initial?.provider ?? 'anthropic';
    setProvider(p);
    setModel(initial?.model ?? defaultModelId(models[p] ?? []));
    setApiKey('');
    setBudget(initial?.monthlyBudgetEur == null ? '' : String(initial.monthlyBudgetEur));
  }, [open, initial, models]);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onCancel();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, busy, onCancel]);

  if (!open || typeof document === 'undefined') return null;

  const providerModels = models[provider] ?? [];
  const key = (leaf: string) => t(`${ns}.keys.${leaf}`);

  function changeProvider(next: AiKeyProvider) {
    setProvider(next);
    const opts = models[next] ?? [];
    setModel((prev) => (opts.some((m) => m.id === prev) ? prev : defaultModelId(opts)));
  }

  // In create mode an API key is required; in edit mode it may be left blank.
  const canSubmit =
    label.trim().length > 0 && (mode === 'edit' || apiKey.trim().length >= 10) && !busy;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    const trimmedBudget = budget.trim();
    onSubmit({
      label: label.trim(),
      provider,
      model: model || null,
      apiKey: apiKey.trim(),
      monthlyBudgetEur: trimmedBudget === '' ? null : Number(trimmedBudget),
    });
  }

  const inputClass =
    'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 dialog-enter"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <form
        onSubmit={handleSubmit}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-key-dialog-title"
        className="w-full max-w-md rounded-lg border border-border bg-surface p-6 dialog-card-enter"
      >
        <h2 id="ai-key-dialog-title" className="font-display text-xl font-semibold text-foreground">
          {mode === 'create' ? key('addKey') : key('editKey')}
        </h2>

        <div className="mt-4 space-y-3">
          <label className="block text-sm font-medium text-foreground-secondary">
            {key('fieldLabel')}
            <input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={key('fieldLabelPlaceholder')}
              className={`mt-1 ${inputClass}`}
            />
          </label>

          <label className="block text-sm font-medium text-foreground-secondary">
            {key('fieldProvider')}
            <select
              aria-label={key('fieldProvider')}
              value={provider}
              onChange={(e) => changeProvider(e.target.value as AiKeyProvider)}
              className={`mt-1 ${inputClass}`}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-foreground-secondary">
            {key('fieldModel')}
            <select
              aria-label={key('fieldModel')}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={providerModels.length === 0}
              className={`mt-1 ${inputClass} disabled:opacity-50`}
            >
              {providerModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.recommendedForToolUse ? `${m.label} — ${key('modelRecommended')}` : m.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-foreground-secondary">
            {key('fieldApiKey')}
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                mode === 'edit' && initial?.keyLast4
                  ? key('fieldApiKeyKeep')
                  : key('fieldApiKeyPlaceholder')
              }
              className={`mt-1 ${inputClass}`}
            />
          </label>

          <label className="block text-sm font-medium text-foreground-secondary">
            {key('fieldBudget')}
            <input
              type="number"
              min={0}
              step="0.01"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder={key('fieldBudgetPlaceholder')}
              className={`mt-1 ${inputClass}`}
            />
          </label>
          <p className="text-xs text-muted">{key('fieldBudgetHint')}</p>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="cancel" size="sm" onClick={onCancel} disabled={busy}>
            {key('cancel')}
          </Button>
          <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!canSubmit}>
            {key('save')}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
