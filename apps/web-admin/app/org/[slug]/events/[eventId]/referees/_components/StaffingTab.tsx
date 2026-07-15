'use client';

/**
 * StaffingTab — per-tournament referee slot configuration UI.
 *
 * Renders three sections (Pool / Bracket / Finals). Each section has a
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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, SkillBadge, useToast } from '@myclash/ui';
import { t } from '@myclash/i18n';

const PHASE_TYPES = ['pool', 'bracket', 'finals'] as const;
type PhaseType = (typeof PHASE_TYPES)[number];

interface SlotFormState {
  index: number;
  displayName: string;
  allowedSkillIds: string[];
}

interface PhaseSectionState {
  pool: SlotFormState[];
  bracket: SlotFormState[];
  finals: SlotFormState[];
}

interface ResolvedConfigResponse {
  pool: Array<{ index: number; displayName: string | null; allowedSkillIds: string[] }>;
  bracket: Array<{ index: number; displayName: string | null; allowedSkillIds: string[] }>;
  finals: Array<{ index: number; displayName: string | null; allowedSkillIds: string[] }>;
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
    fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const rows = (await res.json()) as Array<{ id: string; name: string; status?: string }>;
        setTournaments(rows.map((r) => ({ id: r.id, name: r.name, status: r.status })));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [eventId, apiUrl]);

  // Load slot config whenever the target changes (tournament or event default).
  const loadConfig = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    const url =
      selectedTournamentId === 'event-default'
        ? `${apiUrl}/api/v1/events/${eventId}/slot-config`
        : `${apiUrl}/api/v1/tournaments/${selectedTournamentId}/slot-config`;
    fetch(url, { credentials: 'include', signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as ResolvedConfigResponse;
        setResolved(data);
        setConfig(toFormState(data));
        // Default the override toggle to ON when tournament has its own rows.
        setOverrideMode(!data.inheritsEventDefault && selectedTournamentId !== 'event-default');
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [apiUrl, eventId, selectedTournamentId]);

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
      const url =
        selectedTournamentId === 'event-default'
          ? `${apiUrl}/api/v1/events/${eventId}/slot-config`
          : `${apiUrl}/api/v1/tournaments/${selectedTournamentId}/slot-config`;
      const res = await fetch(url, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as {
          affectedAssignments?: AffectedAssignment[];
        };
        setPendingDestructive({
          affected: body.affectedAssignments ?? [],
          payload,
        });
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        toast.error(body.message ?? t('organizer.staffing.saveError'));
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
  function clone(slots: ResolvedConfigResponse['pool']): SlotFormState[] {
    return slots.map((s) => ({
      index: s.index,
      displayName: s.displayName ?? '',
      allowedSkillIds: [...s.allowedSkillIds],
    }));
  }
  return {
    pool: clone(resp.pool),
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
    bracket: pack(state.bracket),
    finals: pack(state.finals),
  };
}
