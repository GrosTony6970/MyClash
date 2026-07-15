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
import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  SkillBadge,
  tintBgClassFor,
} from '@myclash/ui';
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
  /** Slice 6: per-event hidden flag. */
  isHidden?: boolean;
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
  /**
   * Slice 6: toggle per-event hidden flag. Caller PATCHes
   * `/api/v1/events/:eventId/referee-skills/:skillId/visibility`.
   */
  onToggleVisibility?: (skill: RefereeSkill, nextHidden: boolean) => void | Promise<void>;
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
  onToggleVisibility,
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
      <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
        <p className="text-sm text-muted">{t('organizer.refereesPage.catalogEmpty')}</p>
      </div>
    );
  }

  return (
    <>
      <DataTable>
        <DataTableHead>
          {onReorder && <DataTableCell as="th" className="w-8" />}
          <DataTableCell as="th">{t('organizer.refereesPage.catalogColColor')}</DataTableCell>
          <DataTableCell as="th">{t('organizer.refereesPage.catalogColName')}</DataTableCell>
          <DataTableCell as="th" className="text-center">
            {t('organizer.refereesPage.catalogColCount')}
          </DataTableCell>
          <DataTableCell as="th" className="text-right">
            {t('organizer.refereesPage.catalogColActions')}
          </DataTableCell>
        </DataTableHead>
        <tbody>
          {skills.map((skill) => (
            <DataTableRow
              key={skill.id}
              className={[
                'cursor-pointer',
                dragId === skill.id ? 'opacity-50' : '',
                skill.isHidden ? 'bg-background text-muted' : '',
              ].join(' ')}
              onClick={() => setDrillSkillId(skill.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(skill.id);
              }}
            >
              {onReorder && (
                <DataTableCell
                  className="text-center text-muted cursor-grab active:cursor-grabbing select-none"
                  draggable={!isReadOnly}
                  onDragStart={() => handleDragStart(skill.id)}
                  onDragEnd={() => setDragId(null)}
                  onClick={(e) => e.stopPropagation()}
                  title={t('organizer.refereesPage.catalogDragHandle')}
                >
                  ⋮⋮
                </DataTableCell>
              )}
              <DataTableCell>
                <span
                  className={[
                    'inline-block h-5 w-5 rounded-full border border-border',
                    tintBgClassFor(skill.color),
                  ].join(' ')}
                  aria-hidden="true"
                />
              </DataTableCell>
              <DataTableCell>
                <div className="flex items-center gap-2">
                  {/* R4: description doubles as a tooltip on hover via
                      the wrapping span. */}
                  <span title={skill.description || undefined}>
                    <SkillBadge color={skill.color} label={skill.name} />
                  </span>
                  {skill.isSystem && (
                    <span className="rounded bg-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-secondary">
                      {t('organizer.refereesPage.catalogSystemPill')}
                    </span>
                  )}
                </div>
                {skill.description && (
                  <p
                    className="mt-0.5 truncate text-xs italic text-muted"
                    title={skill.description}
                  >
                    {skill.description}
                  </p>
                )}
              </DataTableCell>
              <DataTableCell className="text-center font-semibold text-foreground-secondary tabular-nums">
                {countsBySkill.get(skill.id) ?? 0}
              </DataTableCell>
              <DataTableCell className="text-right">
                {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events -- stopPropagation wrapper, not an interactive control (buttons inside are focusable) */}
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
                      className="text-xs text-foreground-secondary hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
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
                      className="text-xs text-danger hover:text-danger-hover disabled:opacity-50 disabled:cursor-not-allowed"
                      title={
                        isReadOnly
                          ? t('organizer.deletionRequest.archivedReadOnly')
                          : t('organizer.refereesPage.catalogDeleteAction')
                      }
                    >
                      🗑 {t('organizer.refereesPage.catalogDeleteAction')}
                    </button>
                  )}
                  {onToggleVisibility && (
                    <button
                      type="button"
                      disabled={isReadOnly}
                      onClick={() => void onToggleVisibility(skill, !skill.isHidden)}
                      className="text-xs text-foreground-secondary hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                      title={
                        skill.isHidden
                          ? t('organizer.refereesPage.catalogShowAction')
                          : t('organizer.refereesPage.catalogHideAction')
                      }
                    >
                      {skill.isHidden
                        ? `👁 ${t('organizer.refereesPage.catalogShowAction')}`
                        : `🚫 ${t('organizer.refereesPage.catalogHideAction')}`}
                    </button>
                  )}
                </div>
              </DataTableCell>
            </DataTableRow>
          ))}
        </tbody>
      </DataTable>

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
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- modal backdrop, dismiss-on-click; the close button provides keyboard access
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40" onClick={onClose}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events -- stopPropagation wrapper so backdrop clicks inside the panel don't dismiss */}
      <aside
        className="h-full w-full max-w-md bg-surface shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-border px-5 py-4 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              {t('organizer.refereesPage.catalogDrillEyebrow')}
            </p>
            <h2 className="mt-1 font-display font-semibold text-lg sm:text-xl text-foreground flex items-center gap-2">
              <SkillBadge color={skill.color} label={skill.name} />
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted hover:text-foreground"
          >
            {t('organizer.refereesPage.cancel')}
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {referees.length === 0 ? (
            <p className="text-sm text-muted">{t('organizer.refereesPage.noReferees')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {referees.map((ref) => {
                const qual = ref.qualifications.find((q) => q.skillId === skill.id);
                return (
                  <li key={ref.userId} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{ref.displayName}</p>
                      {ref.clubLabel && (
                        <p className="text-xs text-muted truncate">{ref.clubLabel}</p>
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
                        className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
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
                          className="text-xs text-danger hover:text-danger-hover disabled:opacity-50"
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
