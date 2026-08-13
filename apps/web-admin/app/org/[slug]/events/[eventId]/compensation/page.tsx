'use client';

import { t } from '@myclash/i18n';
import { localeToBcp47 } from '@myclash/time';
import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { CompensationReport } from '@myclash/types';
import { CompensationTopNav } from '../../../../../../src/components/CompensationTopNav';
import { useI18n } from '@myclash/next-i18n/client';
import { compensationToCsv, compensationToPrintHtml } from './compensation-export';
import { getPublicApiUrl } from '@/lib/api-url';

const PHASE_LABEL_KEYS: Record<string, string> = {
  pool: 'organizer.eventCompensation.phases.pool',
  swiss: 'organizer.eventCompensation.phases.swiss',
  bracket: 'organizer.eventCompensation.phases.bracket',
  finals: 'organizer.eventCompensation.phases.finals',
};

/** A referee_skills catalog entry, used to label breakdown rows by skill name. */
interface RefereeSkill {
  id: string;
  name: string;
}

interface PlanOption {
  id: string;
  name: string;
}

interface EventSettings {
  planId: string;
  planName: string;
  maxCompensationAmount: number | null;
  minCompensationAmount: number | null;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'plan'
  );
}

export default function CompensationPage() {
  const { locale } = useI18n();
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = getPublicApiUrl();

  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [settings, setSettings] = useState<EventSettings | null>(null);
  const [report, setReport] = useState<CompensationReport | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [maxCap, setMaxCap] = useState('');
  const [minCap, setMinCap] = useState('');
  const [skills, setSkills] = useState<RefereeSkill[]>([]);
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
            setMinCap(data.minCompensationAmount?.toString() ?? '');
          }
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [eventId, apiUrl]);

  // Referee-skills catalog for this event — labels breakdown rows by skill name
  // (a role is a referee_skills.id, incl. custom skills) instead of a raw ID.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventId}/referee-skills`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        setSkills((await res.json()) as RefereeSkill[]);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
      });
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
          minCompensationAmount: minCap ? parseFloat(minCap) : null,
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

  async function togglePaid(personId: string, paid: boolean) {
    try {
      await fetch(`${apiUrl}/api/v1/events/${eventId}/compensation/payments/${personId}`, {
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
            r.personId === personId
              ? { ...r, paid, paidAt: paid ? new Date().toISOString() : null }
              : r,
          ),
        };
      });
    } catch {
      // Silent — reload will reconcile
    }
  }

  function toggleExpand(personId: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }

  const phaseTokens = (referee: CompensationReport['referees'][number], phase: string) => {
    const total = referee.breakdown
      .filter((b) => b.phase === phase)
      .reduce((s, b) => s + b.subtotal, 0);
    return total > 0 ? total.toFixed(1) : '—';
  };

  const skillNameById: Record<string, string> = {};
  for (const s of skills) skillNameById[s.id] = s.name;

  function downloadCsv() {
    if (!report || report.referees.length === 0) return;
    // BOM so Excel reads accented names as UTF-8.
    const blob = new Blob(['﻿', compensationToCsv(report)], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compensation-${slugify(report.planName)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printReport() {
    if (!report || report.referees.length === 0) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(
      compensationToPrintHtml(
        t('organizer.eventCompensation.exportTitle', { plan: report.planName }),
        report,
      ),
    );
    w.document.close();
    w.focus();
    w.print();
  }

  const canExport = !!report && report.referees.length > 0;

  return (
    <main className="mx-auto p-8 max-w-[110rem]">
      <CompensationTopNav
        active="referees"
        basePath={`/org/${slug}/events/${eventId}/compensation`}
      />
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted mb-1">
        <Link href={`/org/${slug}`} className="hover:text-foreground-secondary">
          {slug}
        </Link>
        <span>/</span>
        <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-foreground-secondary">
          {t('organizer.eventCompensation.event')}
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">
          {t('organizer.eventCompensation.breadcrumb')}
        </span>
      </div>
      <h1 className="font-display font-bold text-2xl sm:text-3xl mb-6">
        {t('organizer.eventCompensation.title')}
      </h1>

      {/* Settings panel */}
      <div className="bg-background border border-border rounded-xl p-4 mb-6">
        <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground-secondary mb-3">
          {t('organizer.eventCompensation.settings')}
        </h2>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <span className="block text-xs text-muted mb-1">
              {t('organizer.eventCompensation.compensationPlan')}
            </span>
            <select
              id="event-compensation-plan"
              aria-label={t('organizer.eventCompensation.compensationPlan')}
              value={selectedPlanId}
              onChange={(e) => setSelectedPlanId(e.target.value)}
              className="border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-surface"
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
            <span className="block text-xs text-muted mb-1">
              {t('organizer.eventCompensation.minAmount')}
            </span>
            <input
              id="event-compensation-min"
              aria-label={t('organizer.eventCompensation.minAmount')}
              type="number"
              min="0"
              step="0.01"
              value={minCap}
              onChange={(e) => setMinCap(e.target.value)}
              placeholder={t('organizer.eventCompensation.noMinimum')}
              className="border border-border rounded-md px-3 py-2 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <span className="block text-xs text-muted mb-1">
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
              className="border border-border rounded-md px-3 py-2 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <button
            onClick={() => void saveSettings()}
            disabled={!selectedPlanId || savingSettings}
            className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold py-2 px-4 rounded-md text-sm transition-colors"
          >
            {savingSettings ? t('organizer.eventCompensation.saving') : t('actions.save')}
          </button>
        </div>
        {settingsError && <p className="text-xs text-danger mt-2">{settingsError}</p>}
      </div>

      {!settings && (
        <div className="bg-info/10 border border-info/30 text-info rounded-lg px-4 py-3 text-sm">
          {t('organizer.eventCompensation.selectPlanHelp')}
        </div>
      )}

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm mb-4">
          {error}
        </div>
      )}

      {settings && (
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-muted">
            {t('organizer.eventCompensation.planLabel')}{' '}
            <span className="font-medium text-foreground-secondary">{settings.planName}</span>
            {settings.minCompensationAmount !== null && (
              <span className="ml-2 text-muted">
                {t('organizer.eventCompensation.minLabel', {
                  amount: settings.minCompensationAmount,
                })}
              </span>
            )}
            {settings.maxCompensationAmount !== null && (
              <span className="ml-2 text-muted">
                {t('organizer.eventCompensation.capLabel', {
                  amount: settings.maxCompensationAmount,
                })}
              </span>
            )}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={downloadCsv}
              disabled={!canExport}
              className="text-sm text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('organizer.eventCompensation.exportCsv')}
            </button>
            <button
              type="button"
              onClick={printReport}
              disabled={!canExport}
              className="text-sm text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('organizer.eventCompensation.exportPdf')}
            </button>
            <button
              onClick={() => void loadReport()}
              disabled={loadingReport}
              className="text-sm text-accent hover:underline disabled:opacity-50"
            >
              {loadingReport ? t('common.loading') : t('organizer.eventCompensation.refresh')}
            </button>
          </div>
        </div>
      )}

      {report && (
        <div className="overflow-x-auto border border-border rounded-xl">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-background border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-3 px-4">{t('organizer.eventCompensation.referee')}</th>
                <th className="py-3 px-4 text-center">
                  {t('organizer.eventCompensation.poolPoints')}
                </th>
                <th className="py-3 px-4 text-center">
                  {t('organizer.eventCompensation.swissPoints')}
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
                  <td colSpan={8} className="py-8 text-center text-muted">
                    {t('organizer.eventCompensation.empty')}
                  </td>
                </tr>
              )}
              {report.referees.map((referee) => (
                <Fragment key={referee.personId}>
                  <tr
                    className="border-b border-border hover:bg-background cursor-pointer"
                    onClick={() => toggleExpand(referee.personId)}
                  >
                    <td className="py-2.5 px-4 font-medium text-foreground">
                      <span aria-hidden="true" className="mr-1 text-muted text-xs">
                        {expandedRows.has(referee.personId) ? 'v' : '>'}
                      </span>
                      {referee.displayName}
                    </td>
                    <td className="py-2.5 px-4 text-center text-foreground-secondary tabular-nums">
                      {phaseTokens(referee, 'pool')}
                    </td>
                    <td className="py-2.5 px-4 text-center text-foreground-secondary tabular-nums">
                      {phaseTokens(referee, 'swiss')}
                    </td>
                    <td className="py-2.5 px-4 text-center text-foreground-secondary tabular-nums">
                      {phaseTokens(referee, 'bracket')}
                    </td>
                    <td className="py-2.5 px-4 text-center text-foreground-secondary tabular-nums">
                      {phaseTokens(referee, 'finals')}
                    </td>
                    <td className="py-2.5 px-4 text-center font-semibold text-foreground tabular-nums">
                      {t('organizer.eventCompensation.pointsValue', {
                        value: referee.totalTokens.toFixed(1),
                      })}
                    </td>
                    <td className="py-2.5 px-4 text-center font-semibold text-foreground tabular-nums">
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
                        onChange={(e) => void togglePaid(referee.personId, e.target.checked)}
                        className="accent-accent w-4 h-4"
                      />
                    </td>
                  </tr>
                  {expandedRows.has(referee.personId) && (
                    <tr
                      key={`${referee.personId}-detail`}
                      className="border-b border-border bg-background"
                    >
                      <td colSpan={8} className="px-8 py-3">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-muted uppercase tracking-wide">
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
                              const phaseLabelKey = PHASE_LABEL_KEYS[line.phase];

                              return (
                                <tr key={i} className="text-foreground-secondary">
                                  <td className="py-0.5">
                                    {skillNameById[line.role] ?? line.role}
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
                          <p className="text-xs text-success mt-2">
                            {t('organizer.eventCompensation.paidOn', {
                              date: new Date(referee.paidAt).toLocaleDateString(
                                localeToBcp47(locale),
                              ),
                            })}
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {report.referees.length > 0 && (
                <tr className="bg-background border-t border-border">
                  <td
                    colSpan={5}
                    className="py-3 px-4 text-sm font-bold text-foreground-secondary text-right"
                  >
                    {t('organizer.eventCompensation.totalToPay')}
                  </td>
                  <td className="py-3 px-4 text-center font-bold text-foreground tabular-nums">
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
