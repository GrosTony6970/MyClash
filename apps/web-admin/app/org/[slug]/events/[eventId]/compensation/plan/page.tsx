'use client';

import { t } from '@myclash/i18n';
import { HelpTooltip, useConfirm } from '@myclash/ui';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { CompensationPlan, CompensationPhase } from '@myclash/types';
import { CompensationTopNav } from '../../../../../../../src/components/CompensationTopNav';
import { rulesetHelp } from '@/components/rulesets/rulesetHelp';
import { useI18n } from '@/i18n/I18nProvider';
import { getPublicApiUrl } from '@/lib/api-url';

/** A referee_skills catalog entry (the 3 system skills + this event's custom skills). */
interface RefereeSkill {
  id: string;
  name: string;
  isSystem: boolean;
  sortOrder: number;
}

const PHASES: { id: CompensationPhase }[] = [{ id: 'pool' }, { id: 'bracket' }, { id: 'finals' }];

type RatesGrid = Record<string, Record<string, string>>;

function makeDefaultGrid(skills: RefereeSkill[]): RatesGrid {
  const g: RatesGrid = {};
  for (const s of skills) {
    g[s.id] = {};
    for (const p of PHASES) {
      g[s.id]![p.id] = '0';
    }
  }
  return g;
}

function planToGrid(plan: CompensationPlan, skills: RefereeSkill[]): RatesGrid {
  const g = makeDefaultGrid(skills);
  for (const rr of plan.roleRates) {
    g[rr.refereeRole] ??= {};
    g[rr.refereeRole]![rr.compensationPhase] = String(rr.tokensPerMatch);
  }
  return g;
}

interface TierRow {
  minTokens: string;
  maxTokens: string;
  amount: string;
}

function planToTierRows(plan: CompensationPlan): TierRow[] {
  const sorted = [...plan.tiers].sort((a, b) => a.minTokens - b.minTokens);
  return sorted.map((t) => ({
    minTokens: String(t.minTokens),
    maxTokens: t.maxTokens != null ? String(t.maxTokens) : '',
    amount: String(t.amount),
  }));
}

export default function OrgCompensationPlansPage() {
  // Locale-aware `t` for the new help copy specifically: the module-level
  // `t` this page imports is bound to EN and would never translate.
  const { t: translate } = useI18n();
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = getPublicApiUrl();
  const { confirm, confirmDialog } = useConfirm();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [plans, setPlans] = useState<CompensationPlan[]>([]);
  const [skills, setSkills] = useState<RefereeSkill[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [ratesGrid, setRatesGrid] = useState<RatesGrid>({});
  const [tierRows, setTierRows] = useState<TierRow[]>([
    { minTokens: '0', maxTokens: '', amount: '0' },
  ]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New plan form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPublic, setNewPublic] = useState(false);
  const [creating, setCreating] = useState(false);

  // Save states
  const [savingRates, setSavingRates] = useState(false);
  const [savingTiers, setSavingTiers] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(slug)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(t('organizer.compensationSettings.organizationLoadError'));
        }
        const org = (await res.json()) as { id: string };
        setOrgId(org.id);
        return fetch(`${apiUrl}/api/v1/compensation-plans`, {
          credentials: 'include',
          signal: controller.signal,
        });
      })
      .then(async (res) => {
        if (!res?.ok) {
          throw new Error(t('organizer.compensationSettings.loadPlansError'));
        }
        setPlans((await res.json()) as CompensationPlan[]);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(
          err instanceof Error ? err.message : t('organizer.compensationSettings.loadPlansError'),
        );
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [slug, apiUrl]);

  // Referee-skills catalog for this event (3 system skills + custom ones) — the
  // source of the role rows, replacing the old hardcoded 3-role list.
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

  const skillNameById: Record<string, string> = {};
  const skillOrderById: Record<string, number> = {};
  for (const s of skills) {
    skillNameById[s.id] = s.name;
    skillOrderById[s.id] = s.sortOrder;
  }

  function expandPlan(plan: CompensationPlan) {
    setExpandedId(plan.id);
    setRatesGrid(planToGrid(plan, skills));
    setTierRows(
      planToTierRows(plan).length > 0
        ? planToTierRows(plan)
        : [{ minTokens: '0', maxTokens: '', amount: '0' }],
    );
    setSaveError(null);
  }

  async function createPlan() {
    if (!newName.trim()) return;
    if (!orgId) {
      setError(t('organizer.compensationSettings.organizationLoadError'));
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/organizations/${orgId}/compensation-plans`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim() || undefined,
          publicVisibility: newPublic,
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? t('organizer.compensationSettings.createError'));
      }
      const plan = (await res.json()) as CompensationPlan;
      setPlans((prev) => [...prev, plan]);
      setShowNewForm(false);
      setNewName('');
      setNewDesc('');
      setNewPublic(false);
      expandPlan(plan);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('organizer.compensationSettings.createError'),
      );
    } finally {
      setCreating(false);
    }
  }

  async function deletePlan(planId: string) {
    if (
      !(await confirm({ title: t('organizer.compensationSettings.deleteConfirm'), danger: true }))
    )
      return;
    try {
      await fetch(`${apiUrl}/api/v1/compensation-plans/${planId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      setPlans((prev) => prev.filter((p) => p.id !== planId));
      if (expandedId === planId) setExpandedId(null);
    } catch {
      // ignore
    }
  }

  async function saveRates(planId: string) {
    setSavingRates(true);
    setSaveError(null);
    try {
      const knownIds = new Set(skills.map((s) => s.id));
      const gridRates = skills.flatMap((s) =>
        PHASES.map((p) => ({
          refereeRole: s.id,
          compensationPhase: p.id,
          tokensPerMatch: parseFloat(ratesGrid[s.id]?.[p.id] ?? '0') || 0,
        })),
      );
      // This plan may be reused across events; upsert is delete-then-insert, so
      // preserve any rates set for a skill not in the current event's catalog.
      const preserved = (plans.find((p) => p.id === planId)?.roleRates ?? [])
        .filter((rr) => !knownIds.has(rr.refereeRole))
        .map((rr) => ({
          refereeRole: rr.refereeRole,
          compensationPhase: rr.compensationPhase,
          tokensPerMatch: rr.tokensPerMatch,
        }));
      const rates = [...gridRates, ...preserved];
      const res = await fetch(`${apiUrl}/api/v1/compensation-plans/${planId}/role-rates`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rates }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? t('organizer.compensationSettings.saveRatesError'));
      }
      const updated = (await res.json()) as CompensationPlan;
      setPlans((prev) => prev.map((p) => (p.id === planId ? updated : p)));
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : t('organizer.compensationSettings.saveRatesError'),
      );
    } finally {
      setSavingRates(false);
    }
  }

  async function saveTiers(planId: string) {
    setSavingTiers(true);
    setSaveError(null);
    try {
      const tiers = tierRows.map((t) => ({
        minTokens: parseFloat(t.minTokens) || 0,
        maxTokens: t.maxTokens ? parseFloat(t.maxTokens) : null,
        amount: parseFloat(t.amount) || 0,
      }));
      const res = await fetch(`${apiUrl}/api/v1/compensation-plans/${planId}/tiers`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tiers }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? t('organizer.compensationSettings.saveTiersError'));
      }
      const updated = (await res.json()) as CompensationPlan;
      setPlans((prev) => prev.map((p) => (p.id === planId ? updated : p)));
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : t('organizer.compensationSettings.saveTiersError'),
      );
    } finally {
      setSavingTiers(false);
    }
  }

  const builtInPlans = plans.filter((p) => p.builtIn);
  const orgPlans = plans.filter((p) => !p.builtIn && p.organizationId === orgId);

  return (
    <main className="mx-auto p-8 max-w-[110rem]">
      <CompensationTopNav active="plan" basePath={`/org/${slug}/events/${eventId}/compensation`} />
      <h1 className="font-display font-bold text-2xl sm:text-3xl mb-1">
        {t('organizer.compensationSettings.title')}
      </h1>
      <p className="text-muted text-sm mb-6">{t('organizer.compensationSettings.description')}</p>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {loading && <p className="text-muted text-sm">{t('common.loading')}</p>}

      {/* Built-in plans */}
      {builtInPlans.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
            {t('organizer.compensationSettings.builtInPlans')}
          </h2>
          <div className="flex flex-col gap-2">
            {builtInPlans.map((plan) => (
              <div key={plan.id} className="border border-border rounded-xl">
                <div className="flex items-center justify-between px-4 py-3">
                  <div>
                    <span className="font-medium text-foreground">{plan.name}</span>
                    {plan.description && (
                      <span className="ml-2 text-xs text-muted">{plan.description}</span>
                    )}
                    <span className="ml-2 text-xs bg-info/10 text-info px-1.5 py-0.5 rounded">
                      {t('organizer.compensationSettings.builtIn')}
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      expandedId === plan.id ? setExpandedId(null) : expandPlan(plan)
                    }
                    className="text-sm text-muted hover:text-foreground-secondary"
                  >
                    {expandedId === plan.id ? t('actions.close') : t('actions.view')}
                  </button>
                </div>
                {expandedId === plan.id && (
                  <PlanDetails
                    plan={plan}
                    skillNameById={skillNameById}
                    skillOrderById={skillOrderById}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Org plans */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
            {t('organizer.compensationSettings.yourPlans')}
          </h2>
          <button
            onClick={() => setShowNewForm(true)}
            className="text-sm bg-accent hover:bg-accent-hover text-accent-foreground font-semibold py-1.5 px-3 rounded-md transition-colors"
          >
            {t('organizer.compensationSettings.newPlanAction')}
          </button>
        </div>

        {showNewForm && (
          <div className="border border-border rounded-xl p-4 mb-3 bg-warning/10">
            <p className="text-sm font-medium text-foreground-secondary mb-3">
              {t('organizer.compensationSettings.newPlan')}
            </p>
            <div className="flex flex-col gap-3">
              <input
                id="compensation-new-plan-name"
                aria-label={t('organizer.compensationSettings.planName')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('organizer.compensationSettings.planName')}
                className="border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <input
                id="compensation-new-plan-description"
                aria-label={t('organizer.compensationSettings.planDescription')}
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder={t('organizer.compensationSettings.planDescription')}
                className="border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <label
                htmlFor="compensation-new-plan-public"
                className="flex items-center gap-2 text-sm text-foreground-secondary"
              >
                <input
                  id="compensation-new-plan-public"
                  aria-label={t('organizer.compensationSettings.publicVisibility')}
                  type="checkbox"
                  checked={newPublic}
                  onChange={(e) => setNewPublic(e.target.checked)}
                  className="accent-accent"
                />
                {t('organizer.compensationSettings.publicVisibility')}
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => void createPlan()}
                  disabled={!newName.trim() || creating || !orgId}
                  className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold py-2 px-4 rounded-md text-sm"
                >
                  {creating ? t('organizer.compensationSettings.creating') : t('actions.add')}
                </button>
                <button
                  onClick={() => setShowNewForm(false)}
                  className="text-sm text-muted hover:text-foreground-secondary"
                >
                  {t('actions.cancel')}
                </button>
              </div>
            </div>
          </div>
        )}

        {orgPlans.length === 0 && !showNewForm && (
          <p className="text-sm text-muted">
            {t('organizer.compensationSettings.emptyCustomPlans')}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {orgPlans.map((plan) => (
            <div key={plan.id} className="border border-border rounded-xl">
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="font-medium text-foreground">{plan.name}</span>
                  {plan.publicVisibility && (
                    <span className="ml-2 text-xs bg-success/10 text-success px-1.5 py-0.5 rounded">
                      {t('organizer.compensationSettings.public')}
                    </span>
                  )}
                </div>
                <div className="flex gap-3 items-center">
                  <button
                    onClick={() =>
                      expandedId === plan.id ? setExpandedId(null) : expandPlan(plan)
                    }
                    className="text-sm text-accent hover:underline"
                  >
                    {expandedId === plan.id ? t('actions.close') : t('actions.edit')}
                  </button>
                  <button
                    onClick={() => void deletePlan(plan.id)}
                    className="text-xs text-muted hover:text-danger"
                  >
                    {t('actions.delete')}
                  </button>
                </div>
              </div>
              {expandedId === plan.id && (
                <div className="border-t border-border px-4 py-4">
                  {saveError && <p className="text-xs text-danger mb-3">{saveError}</p>}

                  {/* Rates grid */}
                  <div className="mb-5">
                    <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-2">
                      {t('organizer.compensationSettings.tokenRates')}
                    </p>
                    <div className="overflow-x-auto">
                      <table className="text-sm border-collapse">
                        <thead>
                          <tr>
                            <th
                              aria-label={t('organizer.compensationSettings.role')}
                              className="text-left text-xs text-muted font-normal pr-4 pb-2"
                            />
                            {PHASES.map((p) => (
                              <th
                                key={p.id}
                                className="text-center text-xs text-muted font-medium px-3 pb-2"
                              >
                                {t(`organizer.compensationSettings.phases.${p.id}`)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {skills.map((s) => (
                            <tr key={s.id}>
                              <td className="text-xs text-foreground-secondary pr-4 py-1">
                                {s.name}
                              </td>
                              {PHASES.map((p) => (
                                <td key={p.id} className="px-2 py-1">
                                  <input
                                    aria-label={t('organizer.compensationSettings.rateInputLabel', {
                                      role: s.name,
                                      phase: t(`organizer.compensationSettings.phases.${p.id}`),
                                    })}
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    value={ratesGrid[s.id]?.[p.id] ?? '0'}
                                    onChange={(e) =>
                                      setRatesGrid((prev) => ({
                                        ...prev,
                                        [s.id]: { ...prev[s.id], [p.id]: e.target.value },
                                      }))
                                    }
                                    className="border border-border rounded px-2 py-1 text-sm w-16 text-center focus:outline-none focus:ring-1 focus:ring-accent"
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button
                      onClick={() => void saveRates(plan.id)}
                      disabled={savingRates}
                      className="mt-2 text-xs bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground px-3 py-1.5 rounded"
                    >
                      {savingRates
                        ? t('organizer.compensationSettings.saving')
                        : t('organizer.compensationSettings.saveRates')}
                    </button>
                  </div>

                  {/* Tiers */}
                  <div>
                    <p className="mb-2 flex items-center text-xs font-semibold uppercase tracking-wide text-foreground-secondary">
                      {t('organizer.compensationSettings.tiers')}
                      <HelpTooltip text={rulesetHelp('compensationTiers', translate)} />
                    </p>
                    <div className="flex flex-col gap-1 mb-2">
                      <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs text-muted uppercase tracking-wide mb-1">
                        <span>{t('organizer.compensationSettings.minTokens')}</span>
                        <span>{t('organizer.compensationSettings.maxTokens')}</span>
                        <span>{t('organizer.compensationSettings.amount')}</span>
                        <span />
                      </div>
                      {tierRows.map((tier, i) => (
                        <div
                          key={i}
                          className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center"
                        >
                          <input
                            aria-label={t('organizer.compensationSettings.minTokensRow', {
                              row: i + 1,
                            })}
                            type="number"
                            min="0"
                            value={tier.minTokens}
                            onChange={(e) =>
                              setTierRows((prev) =>
                                prev.map((t, j) =>
                                  j === i ? { ...t, minTokens: e.target.value } : t,
                                ),
                              )
                            }
                            className="border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                          <input
                            aria-label={t('organizer.compensationSettings.maxTokensRow', {
                              row: i + 1,
                            })}
                            type="number"
                            min="0"
                            placeholder={t('organizer.compensationSettings.noMaximum')}
                            value={tier.maxTokens}
                            onChange={(e) =>
                              setTierRows((prev) =>
                                prev.map((t, j) =>
                                  j === i ? { ...t, maxTokens: e.target.value } : t,
                                ),
                              )
                            }
                            className="border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                          <input
                            aria-label={t('organizer.compensationSettings.amountRow', {
                              row: i + 1,
                            })}
                            type="number"
                            min="0"
                            step="0.01"
                            value={tier.amount}
                            onChange={(e) =>
                              setTierRows((prev) =>
                                prev.map((t, j) =>
                                  j === i ? { ...t, amount: e.target.value } : t,
                                ),
                              )
                            }
                            className="border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                          <button
                            aria-label={t('organizer.compensationSettings.removeTierRow', {
                              row: i + 1,
                            })}
                            onClick={() => setTierRows((prev) => prev.filter((_, j) => j !== i))}
                            className="text-xs text-muted hover:text-danger"
                          >
                            {t('actions.remove')}
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 items-center">
                      <button
                        onClick={() =>
                          setTierRows((prev) => [
                            ...prev,
                            { minTokens: '0', maxTokens: '', amount: '0' },
                          ])
                        }
                        className="text-xs text-muted hover:text-foreground-secondary border border-border rounded px-2 py-1"
                      >
                        {t('organizer.compensationSettings.addRow')}
                      </button>
                      <button
                        onClick={() => void saveTiers(plan.id)}
                        disabled={savingTiers}
                        className="text-xs bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground px-3 py-1.5 rounded"
                      >
                        {savingTiers
                          ? t('organizer.compensationSettings.saving')
                          : t('organizer.compensationSettings.saveTiers')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
      {confirmDialog}
    </main>
  );
}

function PlanDetails({
  plan,
  skillNameById,
  skillOrderById,
}: {
  plan: CompensationPlan;
  skillNameById: Record<string, string>;
  skillOrderById: Record<string, number>;
}) {
  const sortedTiers = [...plan.tiers].sort((a, b) => a.minTokens - b.minTokens);
  // Show only the roles this (read-only, built-in) plan actually defines,
  // labeled by catalog name and ordered by the skill's sort order.
  const roleIds = [...new Set(plan.roleRates.map((rr) => rr.refereeRole))].sort(
    (a, b) => (skillOrderById[a] ?? 999) - (skillOrderById[b] ?? 999) || a.localeCompare(b),
  );
  return (
    <div className="border-t border-border px-4 py-4 text-sm">
      <div className="grid grid-cols-2 gap-6">
        <div>
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
            {t('organizer.compensationSettings.tokenRatesReadonly')}
          </p>
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                <th
                  aria-label={t('organizer.compensationSettings.role')}
                  className="text-left text-muted font-normal pr-3 pb-1"
                />
                {PHASES.map((p) => (
                  <th key={p.id} className="text-center text-muted font-medium px-2 pb-1">
                    {t(`organizer.compensationSettings.phases.${p.id}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roleIds.map((roleId) => (
                <tr key={roleId}>
                  <td className="text-foreground-secondary pr-3 py-0.5">
                    {skillNameById[roleId] ?? roleId}
                  </td>
                  {PHASES.map((p) => {
                    const rr = plan.roleRates.find(
                      (x) => x.refereeRole === roleId && x.compensationPhase === p.id,
                    );
                    return (
                      <td
                        key={p.id}
                        className="text-center px-2 py-0.5 text-foreground-secondary tabular-nums"
                      >
                        {rr?.tokensPerMatch ?? 0}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
            {t('organizer.compensationSettings.tiersReadonly')}
          </p>
          {sortedTiers.length === 0 ? (
            <p className="text-muted">{t('organizer.compensationSettings.noTiers')}</p>
          ) : (
            <table className="text-xs">
              <thead>
                <tr className="text-muted">
                  <th className="text-left pr-3 pb-1">
                    {t('organizer.compensationSettings.from')}
                  </th>
                  <th className="text-left pr-3 pb-1">{t('organizer.compensationSettings.to')}</th>
                  <th className="text-left pb-1">
                    {t('organizer.compensationSettings.amountShort')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedTiers.map((tier) => (
                  <tr key={tier.id}>
                    <td className="pr-3 py-0.5 tabular-nums">{tier.minTokens}</td>
                    <td className="pr-3 py-0.5 tabular-nums">
                      {tier.maxTokens ?? t('organizer.compensationSettings.noMaximum')}
                    </td>
                    <td className="py-0.5 tabular-nums font-medium">
                      {t('organizer.compensationSettings.euroAmount', { amount: tier.amount })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
