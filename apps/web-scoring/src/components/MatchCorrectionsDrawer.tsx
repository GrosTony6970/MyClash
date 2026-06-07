'use client';

/**
 * MatchCorrectionsDrawer — right-side slide-over containing all the
 * less-frequent match correction tools. Replaces the always-visible
 * panel that used to dominate the scoreboard middle.
 *
 * Inside:
 *   - Swap fighter color / side
 *   - Time adjust (+/- seconds)
 *   - Exchange edit (select-from-list + "Edit as no exchange")
 *   - RESET MATCH (text-confirmation gate)
 *
 * "Clear last exchange" is NOT here — it lives inline in the centre
 * column so the operator doesn't have to open a drawer for the most
 * common correction action.
 */

import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';

interface MatchCorrectionsDrawerProps {
  open: boolean;
  onClose: () => void;
  matchId: string;
  apiUrl: string;
  online: boolean;
  locked: boolean;
  onDone: () => void;
}

interface ExchangeSummary {
  id: string;
  sequence: number;
  type: string;
  voided: boolean;
}

export function MatchCorrectionsDrawer({
  open,
  onClose,
  matchId,
  apiUrl,
  online,
  locked,
  onDone,
}: MatchCorrectionsDrawerProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetText, setResetText] = useState('');
  const [reason, setReason] = useState('');
  const [adjustSeconds, setAdjustSeconds] = useState(10);
  const [exchanges, setExchanges] = useState<ExchangeSummary[]>([]);
  const [selectedExchangeId, setSelectedExchangeId] = useState('');

  useEffect(() => {
    if (!open || !online) return;
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/matches/${matchId}/exchanges`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) {
          const rows = ((await res.json()) as ExchangeSummary[]).filter((row) => !row.voided);
          setExchanges(rows);
          setSelectedExchangeId(rows.at(-1)?.id ?? '');
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [open, apiUrl, matchId, online]);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const disabled = busy || !online || locked;

  async function post(path: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? t('scoring.corrections.actionFailed'));
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('scoring.corrections.actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function editSelectedExchange() {
    if (!selectedExchangeId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/exchanges/${selectedExchangeId}/edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          reason: reason || t('scoring.corrections.defaultReason'),
          clientUuid: crypto.randomUUID(),
          sequence: 0,
          type: 'no_exchange',
          occurredAt: new Date().toISOString(),
          noExchangeReason: 'other',
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? t('scoring.corrections.actionFailed'));
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('scoring.corrections.actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-white text-slate-900 shadow-2xl"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <h2 className="text-base font-bold uppercase tracking-wide">
            {t('scoring.lice.matchCorrections')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm font-bold hover:bg-slate-50"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4 p-4">
          {!online && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {t('scoring.corrections.onlineOnly')}
            </p>
          )}
          {locked && (
            <p className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-700">
              {t('scoring.corrections.locked')}
            </p>
          )}
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}

          {/* Swap controls */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => void post(`/api/v1/matches/${matchId}/swap-fighter-color`)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold hover:bg-slate-50 disabled:opacity-40"
            >
              {t('scoring.corrections.swapColor')}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => void post(`/api/v1/matches/${matchId}/swap-fighter-side`)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold hover:bg-slate-50 disabled:opacity-40"
            >
              {t('scoring.corrections.swapSide')}
            </button>
          </div>

          {/* Time adjust */}
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
              {t('scoring.corrections.adjustSeconds')}
            </p>
            <div className="grid grid-cols-[1fr_auto_auto] gap-2">
              <input
                type="number"
                min={1}
                value={adjustSeconds}
                onChange={(e) => setAdjustSeconds(parseInt(e.target.value, 10) || 1)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                aria-label={t('scoring.corrections.adjustSeconds')}
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  void post(`/api/v1/matches/${matchId}/clock/adjust`, {
                    adjustmentMs: adjustSeconds * 1000,
                    reason: reason || t('scoring.corrections.defaultReason'),
                  })
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold hover:bg-slate-50 disabled:opacity-40"
              >
                {t('scoring.corrections.addTime')}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  void post(`/api/v1/matches/${matchId}/clock/adjust`, {
                    adjustmentMs: -adjustSeconds * 1000,
                    reason: reason || t('scoring.corrections.defaultReason'),
                  })
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold hover:bg-slate-50 disabled:opacity-40"
              >
                {t('scoring.corrections.subtractTime')}
              </button>
            </div>
          </div>

          {/* Exchange editor */}
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
              {t('scoring.corrections.selectExchange')}
            </p>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <select
                value={selectedExchangeId}
                onChange={(e) => setSelectedExchangeId(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">{t('scoring.corrections.selectExchange')}</option>
                {exchanges.map((exchange) => (
                  <option key={exchange.id} value={exchange.id}>
                    #{exchange.sequence} {exchange.type}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={disabled || !selectedExchangeId}
                onClick={() => void editSelectedExchange()}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold hover:bg-slate-50 disabled:opacity-40"
              >
                {t('scoring.corrections.editAsNoExchange')}
              </button>
            </div>
          </div>

          {/* Correction reason */}
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('scoring.corrections.reason')}
            aria-label={t('scoring.corrections.reason')}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />

          {/* Danger zone */}
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-red-700">
              {t('scoring.corrections.resetMatch')}
            </p>
            <input
              value={resetText}
              onChange={(e) => setResetText(e.target.value)}
              placeholder={t('scoring.corrections.resetConfirmation')}
              aria-label={t('scoring.corrections.resetConfirmation')}
              className="mb-2 w-full rounded-lg border border-red-300 bg-white px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={disabled || resetText !== 'RESET MATCH'}
              onClick={() =>
                void post(`/api/v1/matches/${matchId}/reset`, {
                  confirmation: resetText,
                  reason: reason || t('scoring.corrections.defaultReason'),
                })
              }
              className="w-full rounded-lg border border-red-600 bg-red-600 px-3 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-40"
            >
              {t('scoring.corrections.resetMatch')}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
