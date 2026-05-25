'use client';

/**
 * SkillCatalog — Qualifications tab catalog view.
 *
 * Replaces the legacy person×skill rating matrix on the Qualifications
 * tab with a skill-first table:
 *   row = skill (system + custom)
 *   cols = color swatch · name · qualified-referee count · edit · delete
 *
 * Clicking a row opens a drill-down drawer that lists every event
 * referee with a 1–5 rating selector for that one skill. The drawer
 * re-uses the parent page's `upsertQualification` / `removeQualification`
 * handlers — same backend endpoints as the legacy matrix, so existing
 * data continues to round-trip.
 *
 * System skills (Déclarant / Assesseur / Table) show a "system" pill
 * and hide both edit + delete buttons (the backend rejects either
 * action anyway).
 */

import { useMemo, useState } from 'react';
import { SkillBadge, tintBgClassFor } from '@myclash/ui';
import { t } from '@myclash/i18n';

export interface RefereeSkill {
  id: string;
  eventId: string | null;
  name: string;
  color: string;
  isSystem: boolean;
  sortOrder: number;
  /** R4: optional free-text tooltip / subtitle. Empty when unset. */
  description?: string;
}

export interface RefereeRowForCatalog {
  /** Post-0063: canonical identity (= global_persons.id). */
  personId: string;
  /** Derived display field (= global_persons.claimed_by_user_id), nullable. */
  userId: string | null;
  displayName: string;
  clubLabel: string | null;
  qualifications: Array<{ skillId: string; rating: number | null }>;
}

interface Props {
  skills: RefereeSkill[];
  referees: RefereeRowForCatalog[];
  isReadOnly: boolean;
  onEditSkill: (skill: RefereeSkill) => void;
  onDeleteSkill: (skill: RefereeSkill) => void;
  onUpsertQualification: (personId: string, skillId: string, rating: number | null) => void;
  onRemoveQualification: (personId: string, skillId: string) => void;
  /**
   * R5: drag-reorder. Caller persists via
   * `PATCH /api/v1/events/:eventId/referee-skills/reorder`. Receives
   * the full ordered list of skill IDs (the order shown after the drop).
   */
  onReorder?: (orderedSkillIds: string[]) => void | Promise<void>;
}

export function SkillCatalog({
  skills,
  referees,
  isReadOnly,
  onEditSkill,
  onDeleteSkill,
  onUpsertQualification,
  onRemoveQualification,
  onReorder,
}: Props) {
  const [drillSkillId, setDrillSkillId] = useState<string | null>(null);
  const drillSkill = drillSkillId ? (skills.find((s) => s.id === drillSkillId) ?? null) : null;

  /**
   * R5: drag-reorder via native HTML5 drag-and-drop (no extra deps).
   * `dragId` tracks the row currently being dragged; on drop we
   * compute the new order and call onReorder. Local-state preview is
   * omitted — caller is expected to refresh the skill list after
   * onReorder resolves, which re-orders rows naturally.
   */
  const [dragId, setDragId] = useState<string | null>(null);
  function handleDragStart(skillId: string) {
    setDragId(skillId);
  }
  function handleDragOver(e: React.DragEvent) {
    if (dragId !== null) e.preventDefault();
  }
  function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId || !onReorder) {
      setDragId(null);
      return;
    }
    const ids = skills.map((s) => s.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) {
      setDragId(null);
      return;
    }
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    setDragId(null);
    void onReorder(next);
  }

  /**
   * Count of referees that hold each skill (any rating, including null).
   * A `null` rating still represents "qualified" in this codebase — the
   * matrix UI treats null as "qualified, unrated", and the catalog count
   * mirrors that to stay consistent with the existing data model.
   */
  const countsBySkill = useMemo(() => {
    const counts = new Map<string, number>();
    for (const skill of skills) counts.set(skill.id, 0);
    for (const ref of referees) {
      for (const qual of ref.qualifications) {
        counts.set(qual.skillId, (counts.get(qual.skillId) ?? 0) + 1);
      }
    }
    return counts;
  }, [skills, referees]);

  if (skills.length === 0) {
    return (
      <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
        <p className="text-sm text-gray-400">{t('organizer.refereesPage.catalogEmpty')}</p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              {onReorder && <th className="w-8 px-2 py-2"></th>}
              <th className="px-4 py-2">{t('organizer.refereesPage.catalogColColor')}</th>
              <th className="px-4 py-2">{t('organizer.refereesPage.catalogColName')}</th>
              <th className="px-4 py-2 text-center">
                {t('organizer.refereesPage.catalogColCount')}
              </th>
              <th className="px-4 py-2 text-right">
                {t('organizer.refereesPage.catalogColActions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {skills.map((skill) => (
              <tr
                key={skill.id}
                className={[
                  'border-t border-gray-100 hover:bg-gray-50 cursor-pointer',
                  dragId === skill.id ? 'opacity-50' : '',
                ].join(' ')}
                onClick={() => setDrillSkillId(skill.id)}
                onDragOver={handleDragOver}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(skill.id);
                }}
              >
                {onReorder && (
                  <td
                    className="px-2 py-3 text-center text-gray-400 cursor-grab active:cursor-grabbing select-none"
                    draggable={!isReadOnly}
                    onDragStart={() => handleDragStart(skill.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={(e) => e.stopPropagation()}
                    title={t('organizer.refereesPage.catalogDragHandle')}
                  >
                    ⋮⋮
                  </td>
                )}
                <td className="px-4 py-3">
                  <span
                    className={[
                      'inline-block h-5 w-5 rounded-full border border-gray-200',
                      tintBgClassFor(skill.color),
                    ].join(' ')}
                    aria-hidden="true"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {/* R4: description doubles as a tooltip on hover via
                        the wrapping span. */}
                    <span title={skill.description || undefined}>
                      <SkillBadge color={skill.color} label={skill.name} />
                    </span>
                    {skill.isSystem && (
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        {t('organizer.refereesPage.catalogSystemPill')}
                      </span>
                    )}
                  </div>
                  {skill.description && (
                    <p
                      className="mt-0.5 truncate text-xs italic text-gray-500"
                      title={skill.description}
                    >
                      {skill.description}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-center font-semibold text-gray-700 tabular-nums">
                  {countsBySkill.get(skill.id) ?? 0}
                </td>
                <td className="px-4 py-3 text-right">
                  <div
                    className="inline-flex gap-2"
                    onClick={(e) => e.stopPropagation()}
                    role="group"
                  >
                    {!skill.isSystem && (
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => onEditSkill(skill)}
                        className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                        title={
                          isReadOnly
                            ? t('organizer.deletionRequest.archivedReadOnly')
                            : t('organizer.refereesPage.editSkill')
                        }
                      >
                        ✎ {t('organizer.refereesPage.catalogEditAction')}
                      </button>
                    )}
                    {!skill.isSystem && (
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => onDeleteSkill(skill)}
                        className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        title={
                          isReadOnly
                            ? t('organizer.deletionRequest.archivedReadOnly')
                            : t('organizer.refereesPage.catalogDeleteAction')
                        }
                      >
                        🗑 {t('organizer.refereesPage.catalogDeleteAction')}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {drillSkill && (
        <SkillDrillDownDrawer
          skill={drillSkill}
          referees={referees}
          isReadOnly={isReadOnly}
          onClose={() => setDrillSkillId(null)}
          onUpsertQualification={onUpsertQualification}
          onRemoveQualification={onRemoveQualification}
        />
      )}
    </>
  );
}

interface DrawerProps {
  skill: RefereeSkill;
  referees: RefereeRowForCatalog[];
  isReadOnly: boolean;
  onClose: () => void;
  onUpsertQualification: (personId: string, skillId: string, rating: number | null) => void;
  onRemoveQualification: (personId: string, skillId: string) => void;
}

function SkillDrillDownDrawer({
  skill,
  referees,
  isReadOnly,
  onClose,
  onUpsertQualification,
  onRemoveQualification,
}: DrawerProps) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <aside
        className="h-full w-full max-w-md bg-white shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-gray-200 px-5 py-4 flex items-start justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              {t('organizer.refereesPage.catalogDrillEyebrow')}
            </p>
            <h2 className="mt-1 text-lg font-bold text-gray-900 flex items-center gap-2">
              <SkillBadge color={skill.color} label={skill.name} />
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            {t('organizer.refereesPage.cancel')}
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {referees.length === 0 ? (
            <p className="text-sm text-gray-400">{t('organizer.refereesPage.noReferees')}</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {referees.map((ref) => {
                const qual = ref.qualifications.find((q) => q.skillId === skill.id);
                return (
                  <li key={ref.userId} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{ref.displayName}</p>
                      {ref.clubLabel && (
                        <p className="text-xs text-gray-400 truncate">{ref.clubLabel}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        aria-label={t('organizer.refereesPage.catalogDrillRatingLabel')}
                        value={qual?.rating ?? ''}
                        disabled={isReadOnly || !ref.personId}
                        onChange={(e) => {
                          if (!ref.personId) return;
                          const v = e.target.value;
                          const rating = v === '' ? null : Number.parseInt(v, 10);
                          onUpsertQualification(
                            ref.personId,
                            skill.id,
                            Number.isFinite(rating) ? rating : null,
                          );
                        }}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="">
                          {qual
                            ? t('organizer.refereesPage.catalogDrillRatingUnset')
                            : t('organizer.refereesPage.catalogDrillRatingNotQualified')}
                        </option>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                      {qual && (
                        <button
                          type="button"
                          disabled={isReadOnly || !ref.personId}
                          onClick={() => {
                            if (ref.personId) onRemoveQualification(ref.personId, skill.id);
                          }}
                          className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50"
                          title={
                            isReadOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined
                          }
                        >
                          {t('organizer.refereesPage.removeQualification')}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
