'use client';

/**
 * StaffingTab — per-tournament referee slot configuration UI.
 *
 * Renders four sections (Pool / Swiss / Bracket / Finals). Each section has a
 * `1..6` slot-count stepper and N slot rows. Each slot row carries an
 * optional display-name input and a multi-select chip list of allowed
 * skills.
 *
 * A toolbar at the top lets the operator switch tournament and toggle
 * "Inherits from event default" vs "Override per tournament". When
 * inheriting, the form is read-only and shows the resolved default;
 * the same Save button writes to the event default when no tournament
 * is selected.
 *
 * Conflict path: if the save would invalidate existing
 * referee_assignments (slot dropped or skill no longer allowed), the
 * API returns 409 with an `affectedAssignments` list. We show a confirm
 * dialog with the list and re-PUT with confirmDestructive: true.
 */

import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, SkillBadge, useToast } from '@myclash/ui';

const PHASE_TYPES = ['pool', 'swiss', 'bracket', 'finals'] as const;
type PhaseType = (typeof PHASE_TYPES)[number];

interface SlotFormState {
  index: number;
  displayName: string;
  allowedSkillIds: string[];
}

type PhaseSectionState = Record<PhaseType, SlotFormState[]>;

type ResolvedSlotResponse = {
  index: number;
  displayName: string | null;
  allowedSkillIds: string[];
};

interface ResolvedConfigResponse extends Record<PhaseType, ResolvedSlotResponse[]> {
  inheritsEventDefault: boolean;
  isHardCodedFloor: boolean;
}

interface AffectedAssignment {
  id: string;
  poolId: string | null;
  matchId: string | null;
  poolName?: string | null;
  matchLabel?: string | null;
  role: string | null;
  reason: 'slot_out_of_range' | 'role_not_allowed';
}

interface RefereeSkill {
  id: string;
  name: string;
  color: string;
  isSystem: boolean;
}

interface TournamentSummary {
  id: string;
  name: string;
  status?: string;
}

interface Props {
  eventId: string;
  apiUrl: string;
  skills: RefereeSkill[];
  isReadOnly: boolean;
}

export function StaffingTab({ eventId, apiUrl, skills, isReadOnly }: Props) {
  const { t } = useI18n();

  const toast = useToast();
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | 'event-default'>(
    'event-default',
  );
  const [overrideMode, setOverrideMode] = useState<boolean>(false);
  const [config, setConfig] = useState<PhaseSectionState | null>(null);
  const [resolved, setResolved] = useState<ResolvedConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingDestructive, setPendingDestructive] = useState<{
    affected: AffectedAssignment[];
    payload: ReturnType<typeof toApiPayload>;
  } | null>(null);

  // Load tournaments once.
  useEffect(() => {
    const controller = new AbortController();
    // Silent: the target picker falls back to the event default, which is the
    // view this tab opens on anyway.
    void apiRequest<Array<{ id: string; name: string; status?: string }>>(
      apiUrl,
      `/api/v1/events/${eventId}/tournaments`,
      { signal: controller.signal },
    ).then((res) => {
      if (!res.ok) return;
      setTournaments(res.data.map((r) => ({ id: r.id, name: r.name, status: r.status })));
    });
    return () => controller.abort();
  }, [eventId, apiUrl]);

  /** Event default, or the selected tournament's own rows. Read and written. */
  const slotConfigPath =
    selectedTournamentId === 'event-default'
      ? `/api/v1/events/${eventId}/slot-config`
      : `/api/v1/tournaments/${selectedTournamentId}/slot-config`;

  // Load slot config whenever the target changes (tournament or event default).
  const loadConfig = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    // Silent: the form stays on its last resolved config, and the save below
    // reports its own refusal.
    void apiRequest<ResolvedConfigResponse>(apiUrl, slotConfigPath, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) return;
        setResolved(res.data);
        setConfig(toFormState(res.data));
        // Default the override toggle to ON when tournament has its own rows.
        setOverrideMode(!res.data.inheritsEventDefault && selectedTournamentId !== 'event-default');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [apiUrl, slotConfigPath, selectedTournamentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadConfig sets state asynchronously in fetch callbacks, not synchronously
    const cleanup = loadConfig();
    return cleanup;
  }, [loadConfig]);

  // Whether the form is editable on this view.
  // Event-default view: always editable.
  // Tournament view: editable only in override mode.
  const editable = !isReadOnly && (selectedTournamentId === 'event-default' || overrideMode);

  async function handleSave(confirmDestructive = false) {
    if (!config) return;
    const payload = { ...toApiPayload(config), confirmDestructive };
    setSaving(true);
    try {
      const r = await apiRequest(apiUrl, slotConfigPath, { method: 'PUT', body: payload });
      // NOT a message: a 409 means the change would drop referees who are
      // already assigned, and the dialog names them before asking again.
      //
      // Read from `details`, where it has always travelled. The API's exception
      // filter moves every key that is not a standard problem+json member under
      // `details`, so the top-level read this replaces returned undefined every
      // time and the dialog listed nobody.
      if (!r.ok && r.kind === 'http' && r.status === 409) {
        const affected = r.details?.['affectedAssignments'];
        setPendingDestructive({
          affected: Array.isArray(affected) ? (affected as AffectedAssignment[]) : [],
          payload,
        });
        return;
      }
      if (!r.ok) {
        const message = failureMessage(r, t, t('organizer.staffing.saveError'));
        if (message) toast.error(message);
        return;
      }
      toast.success(t('organizer.staffing.saved'));
      setPendingDestructive(null);
      loadConfig();
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (selectedTournamentId === 'event-default') return;
    setSaving(true);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/tournaments/${selectedTournamentId}/slot-config/reset`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) {
        toast.error(t('organizer.staffing.resetError'));
        return;
      }
      toast.success(t('organizer.staffing.resetDone'));
      setOverrideMode(false);
      loadConfig();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-6">
      <header className="rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="grid gap-1 text-sm font-semibold text-foreground-secondary">
            {t('organizer.staffing.tournamentLabel')}
            <select
              value={selectedTournamentId}
              onChange={(e) => setSelectedTournamentId(e.target.value)}
              className="rounded-md border border-border px-3 py-2 text-sm min-w-[16rem]"
            >
              <option value="event-default">{t('organizer.staffing.eventDefault')}</option>
              {tournaments.map((tournament) => (
                <option key={tournament.id} value={tournament.id}>
                  {tournament.name}
                </option>
              ))}
            </select>
          </label>

          {selectedTournamentId !== 'event-default' && (
            <label className="flex items-center gap-2 text-sm font-semibold text-foreground-secondary">
              <input
                type="checkbox"
                checked={overrideMode}
                disabled={isReadOnly}
                onChange={(e) => {
                  setOverrideMode(e.target.checked);
                  if (!e.target.checked && resolved) {
                    // Re-show the inherited values, undoing local edits.
                    setConfig(toFormState(resolved));
                  }
                }}
              />
              {t('organizer.staffing.overrideToggle')}
            </label>
          )}

          {selectedTournamentId !== 'event-default' && (
            <button
              type="button"
              onClick={() => void handleReset()}
              disabled={!editable || saving}
              className="ml-auto rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('organizer.staffing.resetToEventDefault')}
            </button>
          )}
        </div>
        {resolved?.isHardCodedFloor && (
          <p className="mt-3 rounded bg-warning/10 border border-warning/30 px-3 py-2 text-xs text-warning">
            {t('organizer.staffing.usingHardCodedFloor')}
          </p>
        )}
        {selectedTournamentId !== 'event-default' && !overrideMode && (
          <p className="mt-3 text-xs text-muted">{t('organizer.staffing.inheritingExplanation')}</p>
        )}
      </header>

      {loading || !config ? (
        <p className="text-sm text-muted">{t('organizer.staffing.loading')}</p>
      ) : (
        <>
          {PHASE_TYPES.map((phase) => (
            <PhaseSection
              key={phase}
              phase={phase}
              slots={config[phase]}
              skills={skills}
              editable={editable}
              onChange={(slots) => setConfig({ ...config, [phase]: slots })}
            />
          ))}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => void handleSave(false)}
              disabled={!editable || saving}
              className="rounded-md bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground shadow-sm hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? t('organizer.staffing.saving') : t('organizer.staffing.save')}
            </button>
          </div>
        </>
      )}

      {pendingDestructive && (
        <DestructiveConfirmDialog
          affected={pendingDestructive.affected}
          onCancel={() => setPendingDestructive(null)}
          onConfirm={() => void handleSave(true)}
          saving={saving}
        />
      )}
    </section>
  );
}

interface PhaseSectionProps {
  phase: PhaseType;
  slots: SlotFormState[];
  skills: RefereeSkill[];
  editable: boolean;
  onChange: (slots: SlotFormState[]) => void;
}

function PhaseSection({ phase, slots, skills, editable, onChange }: PhaseSectionProps) {
  const { t } = useI18n();

  const skillById = useMemo(() => {
    const m = new Map<string, RefereeSkill>();
    for (const s of skills) m.set(s.id, s);
    return m;
  }, [skills]);

  function setSlotCount(next: number) {
    const clamped = Math.max(1, Math.min(6, next));
    if (clamped === slots.length) return;
    if (clamped > slots.length) {
      const additions: SlotFormState[] = [];
      for (let i = slots.length + 1; i <= clamped; i++) {
        additions.push({
          index: i,
          displayName: '',
          allowedSkillIds: skills[0] ? [skills[0].id] : [],
        });
      }
      onChange([...slots, ...additions]);
    } else {
      onChange(slots.slice(0, clamped));
    }
  }

  function updateSlot(idx: number, patch: Partial<SlotFormState>) {
    onChange(slots.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  /**
   * R5: drag-reorder. Local-only — persists when the user clicks the
   * existing Save button (the PUT payload's `index` per slot is set to
   * the array position + 1, so reorder → save → backend stores the new
   * sequence). Uses native HTML5 drag-and-drop.
   */
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  function handleDrop(targetIdx: number) {
    if (dragIdx === null || dragIdx === targetIdx) {
      setDragIdx(null);
      return;
    }
    const next = [...slots];
    const [moved] = next.splice(dragIdx, 1);
    if (!moved) {
      setDragIdx(null);
      return;
    }
    next.splice(targetIdx, 0, moved);
    // Re-index so display + serialised payload stay 1-based dense.
    onChange(next.map((s, i) => ({ ...s, index: i + 1 })));
    setDragIdx(null);
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground-secondary">
          {t(`organizer.staffing.phase.${phase}`)}
        </h3>
        <label className="flex items-center gap-2 text-xs font-semibold text-foreground-secondary">
          {t('organizer.staffing.slotCount')}
          <input
            type="number"
            min={1}
            max={6}
            value={slots.length}
            disabled={!editable}
            onChange={(e) => setSlotCount(Number.parseInt(e.target.value, 10) || 1)}
            className="w-16 rounded-md border border-border px-2 py-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </label>
      </header>

      <ul className="space-y-2">
        {slots.map((slot, idx) => (
          <li
            key={slot.index}
            className={[
              'grid gap-2 rounded-md border border-border bg-background px-3 py-2 md:grid-cols-[2rem,5rem,12rem,1fr]',
              dragIdx === idx ? 'opacity-50' : '',
            ].join(' ')}
            onDragOver={(e) => {
              if (dragIdx !== null && editable) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(idx);
            }}
          >
            {/* R5: drag handle. Hidden when the form is read-only (e.g.
                tournament view in inherit mode) so the order can't be
                touched without the user explicitly toggling override. */}
            <div
              className={[
                'self-center text-center text-muted select-none',
                editable ? 'cursor-grab active:cursor-grabbing' : 'opacity-30',
              ].join(' ')}
              draggable={editable}
              onDragStart={() => setDragIdx(idx)}
              onDragEnd={() => setDragIdx(null)}
              title={t('organizer.staffing.dragHandle')}
            >
              ⋮⋮
            </div>
            <div className="text-xs font-bold uppercase tracking-wider text-muted self-center">
              {t('organizer.staffing.slotLabel', { index: slot.index })}
            </div>
            <input
              type="text"
              value={slot.displayName}
              disabled={!editable}
              onChange={(e) => updateSlot(idx, { displayName: e.target.value })}
              placeholder={t('organizer.staffing.displayNamePlaceholder')}
              className="rounded-md border border-border px-2 py-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <SkillChipList
              skills={skills}
              skillById={skillById}
              selectedIds={slot.allowedSkillIds}
              editable={editable}
              onChange={(allowedSkillIds) => updateSlot(idx, { allowedSkillIds })}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

interface SkillChipListProps {
  skills: RefereeSkill[];
  skillById: Map<string, RefereeSkill>;
  selectedIds: string[];
  editable: boolean;
  onChange: (ids: string[]) => void;
}

function SkillChipList({ skills, skillById, selectedIds, editable, onChange }: SkillChipListProps) {
  const { t } = useI18n();

  const [pickerOpen, setPickerOpen] = useState(false);
  const available = skills.filter((s) => !selectedIds.includes(s.id));

  function removeSkill(id: string) {
    if (selectedIds.length <= 1) return; // require at least one
    onChange(selectedIds.filter((sid) => sid !== id));
  }

  function addSkill(id: string) {
    if (selectedIds.includes(id)) return;
    onChange([...selectedIds, id]);
    setPickerOpen(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {selectedIds.map((sid) => {
        const skill = skillById.get(sid);
        return (
          <span key={sid} className="inline-flex items-center gap-1">
            <SkillBadge color={skill?.color ?? 'slate'} label={skill?.name ?? sid} />
            {editable && selectedIds.length > 1 && (
              <button
                type="button"
                onClick={() => removeSkill(sid)}
                className="text-xs text-muted hover:text-danger"
                aria-label={t('organizer.staffing.removeSkillFromSlot')}
                title={t('organizer.staffing.removeSkillFromSlot')}
              >
                −
              </button>
            )}
          </span>
        );
      })}
      {editable && available.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="rounded border border-dashed border-border px-2 py-1 text-xs text-muted hover:text-foreground hover:border-border"
          >
            + {t('organizer.staffing.addSkillToSlot')}
          </button>
          {pickerOpen && (
            <div className="absolute left-0 top-full z-10 mt-1 max-h-48 w-56 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-lg">
              {available.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => addSkill(s.id)}
                  className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-background"
                >
                  <SkillBadge color={s.color} label={s.name} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface DestructiveConfirmProps {
  affected: AffectedAssignment[];
  onCancel: () => void;
  onConfirm: () => void;
  saving: boolean;
}

function DestructiveConfirmDialog({
  affected,
  onCancel,
  onConfirm,
  saving,
}: DestructiveConfirmProps) {
  const { t } = useI18n();

  return (
    <Modal
      open
      onClose={onCancel}
      busy={saving}
      size="lg"
      title={t('organizer.staffing.conflict.title')}
      description={t('organizer.staffing.conflict.body', { count: affected.length })}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md border border-border px-4 py-1.5 text-sm font-semibold text-foreground-secondary hover:bg-background"
          >
            {t('organizer.staffing.conflict.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="rounded-md bg-danger px-4 py-1.5 text-sm font-semibold text-danger-foreground hover:bg-danger-hover disabled:opacity-50"
          >
            {saving
              ? t('organizer.staffing.saving')
              : t('organizer.staffing.conflict.confirm', { count: affected.length })}
          </button>
        </>
      }
    >
      <ul className="mt-3 max-h-48 overflow-y-auto rounded border border-border bg-background p-3 text-xs text-foreground-secondary">
        {affected.map((a) => (
          <li
            key={a.id}
            className="flex justify-between gap-2 border-b border-border py-1 last:border-0"
          >
            <span className="font-semibold">
              {a.role ?? '—'}
              <span className="font-normal text-muted">
                {' · '}
                {a.poolName ?? a.matchLabel ?? '—'}
              </span>
            </span>
            <span className="text-muted">{a.reason}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toFormState(resp: ResolvedConfigResponse): PhaseSectionState {
  function clone(slots: ResolvedSlotResponse[] | undefined): SlotFormState[] {
    // `swiss` is absent from a response served by an API that predates it; the
    // resolver seeds it from `pool`, so falling back keeps the section usable.
    return (slots ?? []).map((s) => ({
      index: s.index,
      displayName: s.displayName ?? '',
      allowedSkillIds: [...s.allowedSkillIds],
    }));
  }
  const pool = clone(resp.pool);
  return {
    pool,
    swiss: resp.swiss ? clone(resp.swiss) : pool.map((s) => ({ ...s })),
    bracket: clone(resp.bracket),
    finals: clone(resp.finals),
  };
}

function toApiPayload(state: PhaseSectionState) {
  function pack(slots: SlotFormState[]) {
    return slots.map((s, i) => ({
      index: i + 1,
      displayName: s.displayName.trim() || null,
      allowedSkillIds: s.allowedSkillIds,
    }));
  }
  return {
    pool: pack(state.pool),
    swiss: pack(state.swiss),
    bracket: pack(state.bracket),
    finals: pack(state.finals),
  };
}
