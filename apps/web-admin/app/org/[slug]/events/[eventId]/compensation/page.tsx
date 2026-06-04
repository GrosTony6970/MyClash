'use client';

import { t } from '@myclash/i18n';
import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { CompensationReport } from '@myclash/types';

const ROLE_LABEL_KEYS: Record<string, string> = {
  arbitre_declarant: 'organizer.eventCompensation.roles.arbitre_declarant',
  arbitre_assesseur: 'organizer.eventCompensation.roles.arbitre_assesseur',
  arbitre_table: 'organizer.eventCompensation.roles.arbitre_table',
};

const PHASE_LABEL_KEYS: Record<string, string> = {
  pool: 'organizer.eventCompensation.phases.pool',
  bracket: 'organizer.eventCompensation.phases.bracket',
  finals: 'organizer.eventCompensation.phases.finals',
};

interface PlanOption {
  id: string;
  name: string;
}

interface EventSettings {
  planId: string;
  planName: string;
  maxCompensationAmount: number | null;
}

export default function CompensationPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [settings, setSettings] = useState<EventSettings | null>(null);
  const [report, setReport] = useState<CompensationReport | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [maxCap, setMaxCap] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${apiUrl}/api/v1/compensation-plans`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/compensation/settings`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([plansRes, settingsRes]) => {
        if (plansRes.ok) {
          const data = (await plansRes.json()) as PlanOption[];
          setPlans(data);
        }
        if (settingsRes.ok) {
          const data = (await settingsRes.json()) as EventSettings | null;
          if (data) {
            setSettings(data);
            setSelectedPlanId(data.planId);
            setMaxCap(data.maxCompensationAmount?.toString() ?? '');
          }
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [eventId, apiUrl]);

  useEffect(() => {
    if (!settings) return;
    void loadReport();
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadReport() {
    setLoadingReport(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/compensation/report`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? t('organizer.eventCompensation.loadReportError'));
      }
      setReport((await res.json()) as CompensationReport);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('organizer.eventCompensation.loadReportError'),
      );
    } finally {
      setLoadingReport(false);
    }
  }

  async function saveSettings() {
    if (!selectedPlanId) return;
    setSavingSettings(true);
    setSettingsError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/compensation/settings`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: selectedPlanId,
          maxCompensationAmount: maxCap ? parseFloat(maxCap) : null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? t('organizer.eventCompensation.saveSettingsError'));
      }
      const data = (await res.json()) as EventSettings;
      setSettings(data);
      await loadReport();
    } catch (err) {
      setSettingsError(
        err instanceof Error ? err.message : t('organizer.eventCompensation.saveSettingsError'),
      );
    } finally {
      setSavingSettings(false);
    }
  }

  async function togglePaid(userId: string, paid: boolean) {
    try {
      await fetch(`${apiUrl}/api/v1/events/${eventId}/compensation/payments/${userId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paid }),
      });
      // Optimistic update
      setReport((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          referees: prev.referees.map((r) =>
            r.userId === userId
              ? { ...r, paid, paidAt: paid ? new Date().toISOString() : null }
              : r,
          ),
        };
      });
    } catch {
      // Silent — reload will reconcile
    }
  }

  function toggleExpand(userId: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  const phaseTokens = (referee: CompensationReport['referees'][number], phase: string) => {
    const total = referee.breakdown
      .filter((b) => b.phase === phase)
      .reduce((s, b) => s + b.subtotal, 0);
    return total > 0 ? total.toFixed(1) : '—';
  };

  return (
    <main className="p-8 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
        <Link href={`/org/${slug}`} className="hover:text-gray-700">
          {slug}
        </Link>
        <span>/</span>
        <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-gray-700">
          {t('organizer.eventCompensation.event')}
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">
          {t('organizer.eventCompensation.breadcrumb')}
        </span>
      </div>
      <h1 className="text-2xl font-bold mb-6">{t('organizer.eventCompensation.title')}</h1>

      {/* Settings panel */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          {t('organizer.eventCompensation.settings')}
        </h2>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <span className="block text-xs text-gray-500 mb-1">
              {t('organizer.eventCompensation.compensationPlan')}
            </span>
            <select
              id="event-compensation-plan"
              aria-label={t('organizer.eventCompensation.compensationPlan')}
              value={selectedPlanId}
              onChange={(e) => setSelectedPlanId(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 bg-white"
            >
              <option value="">{t('organizer.eventCompensation.selectPlan')}</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="block text-xs text-gray-500 mb-1">
              {t('organizer.eventCompensation.maxCap')}
            </span>
            <input
              id="event-compensation-cap"
              aria-label={t('organizer.eventCompensation.maxCap')}
              type="number"
              min="0"
              step="0.01"
              value={maxCap}
              onChange={(e) => setMaxCap(e.target.value)}
              placeholder={t('organizer.eventCompensation.noCap')}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
          <button
            onClick={() => void saveSettings()}
            disabled={!selectedPlanId || savingSettings}
            className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-md text-sm transition-colors"
          >
            {savingSettings ? t('organizer.eventCompensation.saving') : t('actions.save')}
          </button>
        </div>
        {settingsError && <p className="text-xs text-red-600 mt-2">{settingsError}</p>}
      </div>

      {!settings && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-4 py-3 text-sm">
          {t('organizer.eventCompensation.selectPlanHelp')}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-4">
          {error}
        </div>
      )}

      {settings && (
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-gray-500">
            {t('organizer.eventCompensation.planLabel')}{' '}
            <span className="font-medium text-gray-700">{settings.planName}</span>
            {settings.maxCompensationAmount !== null && (
              <span className="ml-2 text-gray-400">
                {t('organizer.eventCompensation.capLabel', {
                  amount: settings.maxCompensationAmount,
                })}
              </span>
            )}
          </p>
          <button
            onClick={() => void loadReport()}
            disabled={loadingReport}
            className="text-sm text-red-700 hover:underline disabled:opacity-50"
          >
            {loadingReport ? t('common.loading') : t('organizer.eventCompensation.refresh')}
          </button>
        </div>
      )}

      {report && (
        <div className="overflow-x-auto border border-gray-200 rounded-xl">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-3 px-4">{t('organizer.eventCompensation.referee')}</th>
                <th className="py-3 px-4 text-center">
                  {t('organizer.eventCompensation.poolPoints')}
                </th>
                <th className="py-3 px-4 text-center">
                  {t('organizer.eventCompensation.bracketPoints')}
                </th>
                <th className="py-3 px-4 text-center">
                  {t('organizer.eventCompensation.finalsPoints')}
                </th>
                <th className="py-3 px-4 text-center">{t('organizer.eventCompensation.total')}</th>
                <th className="py-3 px-4 text-center">{t('organizer.eventCompensation.amount')}</th>
                <th className="py-3 px-4 text-center">{t('organizer.eventCompensation.paid')}</th>
              </tr>
            </thead>
            <tbody>
              {report.referees.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-gray-400">
                    {t('organizer.eventCompensation.empty')}
                  </td>
                </tr>
              )}
              {report.referees.map((referee) => (
                <Fragment key={referee.userId}>
                  <tr
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                    onClick={() => toggleExpand(referee.userId)}
                  >
                    <td className="py-2.5 px-4 font-medium text-gray-900">
                      <span aria-hidden="true" className="mr-1 text-gray-400 text-xs">
                        {expandedRows.has(referee.userId) ? 'v' : '>'}
                      </span>
                      {referee.displayName}
                    </td>
                    <td className="py-2.5 px-4 text-center text-gray-600 tabular-nums">
                      {phaseTokens(referee, 'pool')}
                    </td>
                    <td className="py-2.5 px-4 text-center text-gray-600 tabular-nums">
                      {phaseTokens(referee, 'bracket')}
                    </td>
                    <td className="py-2.5 px-4 text-center text-gray-600 tabular-nums">
                      {phaseTokens(referee, 'finals')}
                    </td>
                    <td className="py-2.5 px-4 text-center font-semibold text-gray-800 tabular-nums">
                      {t('organizer.eventCompensation.pointsValue', {
                        value: referee.totalTokens.toFixed(1),
                      })}
                    </td>
                    <td className="py-2.5 px-4 text-center font-semibold text-gray-900 tabular-nums">
                      {t('organizer.eventCompensation.euroAmount', {
                        amount: referee.amountOwed.toFixed(2),
                      })}
                    </td>
                    <td className="py-2.5 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        aria-label={t('organizer.eventCompensation.paidFor', {
                          referee: referee.displayName,
                        })}
                        type="checkbox"
                        checked={referee.paid}
                        onChange={(e) => void togglePaid(referee.userId, e.target.checked)}
                        className="accent-red-700 w-4 h-4"
                      />
                    </td>
                  </tr>
                  {expandedRows.has(referee.userId) && (
                    <tr
                      key={`${referee.userId}-detail`}
                      className="border-b border-gray-100 bg-gray-50"
                    >
                      <td colSpan={7} className="px-8 py-3">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-400 uppercase tracking-wide">
                              <th className="text-left pb-1">
                                {t('organizer.eventCompensation.role')}
                              </th>
                              <th className="text-left pb-1">
                                {t('organizer.eventCompensation.phase')}
                              </th>
                              <th className="text-center pb-1">
                                {t('organizer.eventCompensation.matches')}
                              </th>
                              <th className="text-center pb-1">
                                {t('organizer.eventCompensation.pointsPerMatch')}
                              </th>
                              <th className="text-center pb-1">
                                {t('organizer.eventCompensation.subtotal')}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {referee.breakdown.map((line, i) => {
                              const roleLabelKey = ROLE_LABEL_KEYS[line.role];
                              const phaseLabelKey = PHASE_LABEL_KEYS[line.phase];

                              return (
                                <tr key={i} className="text-gray-600">
                                  <td className="py-0.5">
                                    {roleLabelKey ? t(roleLabelKey) : line.role}
                                  </td>
                                  <td className="py-0.5">
                                    {phaseLabelKey ? t(phaseLabelKey) : line.phase}
                                  </td>
                                  <td className="py-0.5 text-center tabular-nums">
                                    {line.matchCount}
                                  </td>
                                  <td className="py-0.5 text-center tabular-nums">
                                    {line.tokensPerMatch}
                                  </td>
                                  <td className="py-0.5 text-center tabular-nums font-medium">
                                    {line.subtotal.toFixed(1)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {referee.paid && referee.paidAt && (
                          <p className="text-xs text-green-600 mt-2">
                            {t('organizer.eventCompensation.paidOn', {
                              date: new Date(referee.paidAt).toLocaleDateString('fr-FR'),
                            })}
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {report.referees.length > 0 && (
                <tr className="bg-gray-50 border-t border-gray-300">
                  <td colSpan={5} className="py-3 px-4 text-sm font-bold text-gray-700 text-right">
                    {t('organizer.eventCompensation.totalToPay')}
                  </td>
                  <td className="py-3 px-4 text-center font-bold text-gray-900 tabular-nums">
                    {t('organizer.eventCompensation.euroAmount', {
                      amount: report.grandTotal.toFixed(2),
                    })}
                  </td>
                  <td aria-label={t('organizer.eventCompensation.paid')} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
