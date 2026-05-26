'use client';

/**
 * Referee admin — T-906 (rework)
 * Route: /org/[slug]/events/[eventId]/referees
 *
 * Dynamic skill columns, per-row availability toggles, assignment summary.
 */

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { SkillBadge, tintBgClassFor, useToast } from '@myclash/ui';
import { t } from '@myclash/i18n';
import { useEventStatus } from '../_hooks/useEventStatus';
import { SkillCatalog } from './_components/SkillCatalog';
import { StaffingTab } from './_components/StaffingTab';
import { SwapSuggestionsPanel } from './_components/SwapSuggestionsPanel';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RefereeSkill {
  id: string;
  eventId: string | null;
  name: string;
  color: string;
  isSystem: boolean;
  sortOrder: number;
  /** R4: optional tooltip / subtitle. */
  description?: string;
}

interface EventRefereeRow {
  /** Post-0063: canonical identity (= global_persons.id). */
  personId: string;
  /** Derived from global_persons.claimed_by_user_id — nullable for unclaimed. */
  userId: string | null;
  /** True when the person hasn't claimed an account (userId === null). */
  unclaimed: boolean;
  displayName: string;
  clubLabel: string | null;
  qualifications: Array<{ skillId: string; rating: number | null }>;
  availableAllTournaments: boolean;
  availableAllEventDuration: boolean;
  assignments: Array<{ tournamentId: string; tournamentName: string; matchCount: number }>;
  totalMatchCount: number;
}

// qual id lookup: key = `${personId}:${skillId}` → qualId
type RefereeWorkspaceTab = 'referees' | 'qualifications' | 'staffing' | 'assignments';
/**
 * `AssignmentRole` was a hard-coded enum (the 3 legacy roles); R2 of the
 * staffing overhaul loosens it to any `referee_skills.id` string so the
 * board can carry custom slots. The legacy `roleLabel` helper still
 * recognises the 3 well-known IDs and falls back to the raw string for
 * everything else.
 */
type AssignmentRole = string;

interface AssignmentBoardCandidate {
  /** Post-0063: canonical identity (= global_persons.id). */
  personId: string;
  /** Derived from global_persons.claimed_by_user_id (display only). */
  userId: string | null;
  displayName: string;
  clubLabel: string | null;
  qualifications: Array<{ role: AssignmentRole; rating: number | null }>;
  workload: number;
}

interface AssignmentBoardRoleSlot {
  /** R2: new fields from the resolver. */
  slotIndex: number;
  displayName: string | null;
  allowedSkillIds: string[];
  /** Primary skill_id (= allowedSkillIds[0]); kept for legacy compatibility. */
  role: AssignmentRole;
  assignment: {
    id: string;
    /** Derived display field; null for unclaimed referees. */
    userId: string | null;
    personId: string;
    displayName: string;
    status: string;
    autoAssigned: boolean;
  } | null;
  missingReasons: string[];
  candidates: {
    recommended: AssignmentBoardCandidate[];
    warning: Array<AssignmentBoardCandidate & { warnings: string[] }>;
    blocked: Array<AssignmentBoardCandidate & { reasons: string[] }>;
  };
}

interface AssignmentBoardPool {
  id: string;
  name: string;
  tournamentId: string;
  tournamentName: string;
  liceId: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  /** R4: 'pool' (default) | 'bracket' | 'finals'. */
  kind?: 'pool' | 'bracket' | 'finals';
  /** R4: present when kind !== 'pool'; the underlying match id. */
  matchId?: string;
  members: Array<{
    registrationId: string;
    personId: string;
    personName: string;
    clubLabel: string | null;
  }>;
  roleSlots: AssignmentBoardRoleSlot[];
}

/** R4: surfaced from the engine's swap-suggestion computation. */
interface SwapSuggestion {
  fromPoolId: string;
  fromSlotIndex: number;
  fromPersonId: string;
  fromPersonName: string;
  toPersonId: string;
  toPersonName: string;
  reason: 'breaks_back_to_back';
  detail: string;
}

interface AssignmentBoard {
  roles: AssignmentRole[];
  pools: AssignmentBoardPool[];
  unscheduledPools: AssignmentBoardPool[];
  candidates: AssignmentBoardCandidate[];
  missingSlots: Array<{
    poolId: string;
    poolName: string;
    role: AssignmentRole;
    reasons: string[];
  }>;
  warnings: Array<{ poolId: string; poolName: string; role: AssignmentRole; detail: string }>;
  locked: boolean;
  swapSuggestions: SwapSuggestion[];
}

type QualIdMap = Map<string, string>;

// ── Sub-components ────────────────────────────────────────────────────────────

function StarRating({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => onChange(value === star ? null : star)}
          className={[
            'text-lg leading-none transition-colors',
            (value ?? 0) >= star ? 'text-amber-400' : 'text-gray-300',
          ].join(' ')}
          title={t('organizer.refereesPage.ratingTooltip', { star })}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 disabled:opacity-50',
        checked ? 'bg-red-600' : 'bg-gray-200',
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
          checked ? 'translate-x-4' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  );
}

// ── Color token list for the skill modal ─────────────────────────────────────

const COLOR_OPTIONS: string[] = [
  'red',
  'blue',
  'green',
  'purple',
  'orange',
  'amber',
  'teal',
  'yellow',
  'violet',
  'slate',
  'gold',
  'silver',
  'bronze',
  'black',
  'white',
];

// ── Skill modal ───────────────────────────────────────────────────────────────

interface SkillModalProps {
  mode: 'add' | 'edit';
  /** R4: optional description carried through edit. */
  initial?: { name: string; color: string; description?: string };
  skillId?: string;
  /** R4: when editing a system skill, name/colour are read-only. */
  isSystem?: boolean;
  eventId: string;
  apiUrl: string;
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}

function SkillModal({
  mode,
  initial,
  skillId,
  isSystem,
  eventId,
  apiUrl,
  onClose,
  onSaved,
  onDeleted,
}: SkillModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? 'blue');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  async function handleSave() {
    if (!name.trim()) {
      setError(t('organizer.refereesPage.skillNameRequired'));
      return;
    }
    setSaving(true);
    setError(null);

    try {
      let res: Response;
      if (mode === 'add') {
        res = await fetch(`${apiUrl}/api/v1/events/${eventId}/referee-skills`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ name: name.trim(), color, description: description.trim() }),
        });
      } else {
        // R4: on system skills only send description (name/colour are
        // read-only at the backend); on custom skills send everything.
        const payload: Record<string, string> = { description: description.trim() };
        if (!isSystem) {
          payload['name'] = name.trim();
          payload['color'] = color;
        }
        res = await fetch(`${apiUrl}/api/v1/referee-skills/${skillId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        // Surface the backend message rather than swallowing it behind a
        // generic toast — the cause (auth role, DB column, validation) is
        // otherwise impossible to diagnose from the UI alone.
        const body = (await res.json().catch(() => null)) as {
          message?: string | string[];
        } | null;
        const raw = Array.isArray(body?.message) ? body!.message.join(' · ') : body?.message;
        setError(raw || t('organizer.refereesPage.skillSaveFailed'));
        return;
      }

      onSaved();
    } catch {
      // catch fires on network errors (no response body) — keep the generic toast.
      setError(t('organizer.refereesPage.skillSaveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!skillId) return;
    setDeleting(true);
    setError(null);

    try {
      const res = await fetch(`${apiUrl}/api/v1/referee-skills/${skillId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.status === 409) {
        // Parse conflict message — format: "Cannot delete skill: N active qualification(s) still reference it"
        let count: number | null = null;
        try {
          const body = (await res.json()) as { message?: string };
          const msg = body.message ?? '';
          const match = /(\d+)\s+active/.exec(msg);
          if (match) count = parseInt(match[1] ?? '0', 10);
        } catch {
          // ignore parse error
        }
        if (count !== null && count > 0) {
          setError(t('organizer.refereesPage.skillDeleteConflict', { count }));
        } else {
          setError(t('organizer.refereesPage.skillDeleteInUse'));
        }
        return;
      }

      if (!res.ok) {
        setError(t('organizer.refereesPage.skillDeleteFailed'));
        return;
      }

      onDeleted?.();
    } catch {
      setError(t('organizer.refereesPage.skillDeleteFailed'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    /* backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-lg font-semibold mb-4">
          {mode === 'add'
            ? t('organizer.refereesPage.addCustomSkill')
            : t('organizer.refereesPage.editSkill')}
        </h2>

        {error && (
          <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('organizer.refereesPage.skillName')}
            </label>
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              disabled={isSystem}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 disabled:bg-gray-50 disabled:text-gray-500"
              placeholder={t('organizer.refereesPage.skillNamePlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('organizer.refereesPage.skillColor')}
            </label>
            <select
              value={color}
              disabled={isSystem}
              onChange={(e) => setColor(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 disabled:bg-gray-50 disabled:text-gray-500"
            >
              {COLOR_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
            <div className="mt-1">
              <SkillBadge
                color={color}
                label={name || t('organizer.refereesPage.preview')}
                size="sm"
              />
            </div>
          </div>

          {/* R4: optional free-text description. Editable on both system
              and custom skills — surfaces as a tooltip + subtitle in
              the catalog. */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('organizer.refereesPage.skillDescription')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
              placeholder={t('organizer.refereesPage.skillDescriptionPlaceholder')}
            />
          </div>
        </div>

        <div className="flex items-center justify-between mt-6">
          <div>
            {mode === 'edit' && (
              <button
                onClick={() => void handleDelete()}
                disabled={deleting || saving}
                className="text-sm text-red-600 hover:text-red-800 border border-red-200 rounded-lg px-3 py-1.5 disabled:opacity-50"
              >
                {deleting
                  ? t('organizer.refereesPage.deleting')
                  : t('organizer.refereesPage.deleteSkill')}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={saving || deleting}
              className="text-sm text-gray-600 border border-gray-300 rounded-lg px-4 py-1.5 hover:bg-gray-50 disabled:opacity-50"
            >
              {t('organizer.refereesPage.cancel')}
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving || deleting || !name.trim()}
              className="text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg px-4 py-1.5 disabled:opacity-50"
            >
              {saving ? t('organizer.refereesPage.saving') : t('organizer.refereesPage.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function roleLabel(role: AssignmentRole) {
  // The legacy role IDs (`arbitre_declarant` / `_assesseur` / `_table`)
  // have hand-written translations under `organizer.eventCompensation.roles`.
  // For R2 custom slots, the skill_id (e.g. `custom-abcd1234-x9`) won't
  // resolve there — surface a human-readable fallback so the table isn't
  // littered with the raw IDs.
  const known = ['arbitre_declarant', 'arbitre_assesseur', 'arbitre_table'];
  if (known.includes(role)) return t(`organizer.eventCompensation.roles.${role}`);
  return role;
}

function formatTime(value: string | null) {
  if (!value) return t('organizer.refereesPage.unscheduled');
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(value),
  );
}

function CandidateGroup({
  title,
  candidates,
  disabled,
  onSelect,
}: {
  title: string;
  candidates: Array<AssignmentBoardCandidate & { reasons?: string[]; warnings?: string[] }>;
  disabled?: boolean;
  onSelect?: (candidate: AssignmentBoardCandidate) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase text-gray-500">{title}</p>
      <div className="space-y-2">
        {candidates.map((candidate) => (
          <button
            type="button"
            key={candidate.personId}
            disabled={disabled}
            onClick={() => onSelect?.(candidate)}
            className="w-full rounded border border-gray-200 px-3 py-2 text-left text-sm hover:border-gray-300 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
          >
            <span className="block font-medium">{candidate.displayName}</span>
            {candidate.clubLabel && <span className="block text-xs">{candidate.clubLabel}</span>}
            {(candidate.reasons?.length ?? 0) > 0 && (
              <span className="block text-xs">{candidate.reasons?.join(', ')}</span>
            )}
            {(candidate.warnings?.length ?? 0) > 0 && (
              <span className="block text-xs">{candidate.warnings?.join(', ')}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function AssignmentsTab({
  eventId,
  apiUrl,
  isReadOnly,
}: {
  eventId: string;
  apiUrl: string;
  isReadOnly: boolean;
}) {
  const [board, setBoard] = useState<AssignmentBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<{
    pool: AssignmentBoardPool;
    slot: AssignmentBoardRoleSlot;
  } | null>(null);

  async function loadBoard(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/referee-assignment-board`, {
        credentials: 'include',
        signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.refereesPage.assignmentLoadFailed'));
      }
      setBoard((await res.json()) as AssignmentBoard);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(
        err instanceof Error ? err.message : t('organizer.refereesPage.assignmentLoadFailed'),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadBoard(controller.signal);
    return () => controller.abort();
  }, [eventId, apiUrl]);

  async function applyPreview() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/events/${eventId}/referee-assignment-preview/apply`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.refereesPage.assignmentApplyFailed'));
      }
      await loadBoard();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('organizer.refereesPage.assignmentApplyFailed'),
      );
    } finally {
      setRunning(false);
    }
  }

  async function manualAssign(poolId: string, role: AssignmentRole, personId: string) {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/referee-assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ poolId, role, personId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.refereesPage.assignmentApplyFailed'));
      }
      setPicker(null);
      setBoard((await res.json()) as AssignmentBoard);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('organizer.refereesPage.assignmentApplyFailed'),
      );
    } finally {
      setRunning(false);
    }
  }

  /**
   * R4: apply a swap suggestion. Implemented as unassign-then-assign:
   * delete the old assignment for the (poolId, slot) tuple, then POST
   * the new one. Both calls reuse the existing /referee-assignments
   * endpoints — no new backend surface. If the assign step fails after
   * the unassign succeeded, the slot is left empty and the operator
   * sees the failure toast; they can retry manually.
   */
  async function applySwap(suggestion: SwapSuggestion) {
    if (!board) return;
    // Find the existing assignment for that slot so we know which id to delete.
    const pool = [...board.pools, ...board.unscheduledPools].find(
      (p) => p.id === suggestion.fromPoolId,
    );
    const slot = pool?.roleSlots.find((s) => s.slotIndex === suggestion.fromSlotIndex);
    const oldAssignmentId = slot?.assignment?.id;
    setRunning(true);
    setError(null);
    try {
      if (oldAssignmentId) {
        const delRes = await fetch(`${apiUrl}/api/v1/referee-assignments/${oldAssignmentId}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!delRes.ok) {
          const body = (await delRes.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? t('organizer.refereesPage.swapApplyFailed'));
        }
      }
      // Assign the new ref. The board response from POST is the
      // refreshed board, so we use it directly.
      await manualAssign(suggestion.fromPoolId, slot?.role ?? '', suggestion.toPersonId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.refereesPage.swapApplyFailed'));
    } finally {
      setRunning(false);
    }
  }

  async function lockAssignments() {
    setLocking(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/lock-referee-assignments`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.refereesPage.assignmentLockFailed'));
      }
      await loadBoard();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('organizer.refereesPage.assignmentLockFailed'),
      );
    } finally {
      setLocking(false);
    }
  }

  /**
   * R2: pools are grouped by tournament so each tournament's table can
   * show its own slot columns (slot config is per-tournament).
   *
   * Column derivation: within a tournament we pick the slot config from
   * the first pool in the group — every pool of a given tournament shares
   * the same `pool` slot config, so any one is representative. If a pool
   * has fewer roleSlots than expected (legacy data corner case), we
   * render its slots as-is and pad with empty cells.
   */
  function renderPoolRows(pools: AssignmentBoardPool[], unscheduled = false) {
    if (pools.length === 0) return null;
    // R2: group by tournament. R4: within each tournament, split into
    // Pool / Bracket / Finals sub-sections so each sub-section's table
    // can carry its own (potentially different) slot column set.
    const groups = new Map<string, { tournamentName: string; pools: AssignmentBoardPool[] }>();
    for (const pool of pools) {
      const key = pool.tournamentId || pool.tournamentName || 'unknown';
      const bucket = groups.get(key) ?? { tournamentName: pool.tournamentName, pools: [] };
      bucket.pools.push(pool);
      groups.set(key, bucket);
    }
    const KINDS: Array<'pool' | 'bracket' | 'finals'> = ['pool', 'bracket', 'finals'];

    return (
      <div className="space-y-6">
        {Array.from(groups.entries()).map(([key, group]) => (
          <div key={key} className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">{group.tournamentName}</h3>
            {KINDS.map((kind) => {
              const kindPools = group.pools.filter((p) => (p.kind ?? 'pool') === kind);
              if (kindPools.length === 0) return null;
              const headerSlots = kindPools[0]?.roleSlots ?? [];
              return (
                <div key={kind} className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    {t(`organizer.refereesPage.assignmentsSubsection.${kind}`)}
                  </p>
                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-500">
                          <th className="px-3 py-2 font-medium">
                            {t('organizer.refereesPage.poolColumn')}
                          </th>
                          <th className="px-3 py-2 font-medium">
                            {t('organizer.refereesPage.scheduleColumn')}
                          </th>
                          {headerSlots.map((slot) => (
                            <th
                              key={`${slot.slotIndex}:${slot.role}`}
                              className="px-3 py-2 font-medium"
                            >
                              {slot.displayName ?? roleLabel(slot.role)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {kindPools.map((pool) => (
                          <tr key={pool.id} className="border-b border-gray-100 last:border-0">
                            <td className="px-3 py-3 align-top">
                              <p className="font-medium text-gray-900">{pool.name}</p>
                              <p className="mt-1 text-xs text-gray-400">
                                {pool.members.map((member) => member.personName).join(', ')}
                              </p>
                            </td>
                            <td className="px-3 py-3 align-top text-xs text-gray-600">
                              {unscheduled
                                ? t('organizer.refereesPage.unscheduled')
                                : `${formatTime(pool.scheduledStart)}-${formatTime(pool.scheduledEnd)}`}
                            </td>
                            {pool.roleSlots.map((slot) => (
                              <td
                                key={`${slot.slotIndex}:${slot.role}`}
                                className="px-3 py-3 align-top"
                              >
                                <button
                                  type="button"
                                  disabled={isReadOnly || board?.locked}
                                  onClick={() => setPicker({ pool, slot })}
                                  className={[
                                    'min-h-12 w-full rounded border px-2 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                    slot.assignment
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                                      : slot.missingReasons.length
                                        ? 'border-red-200 bg-red-50 text-red-900'
                                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300',
                                  ].join(' ')}
                                >
                                  <span className="block font-medium">
                                    {slot.assignment?.displayName ??
                                      t('organizer.refereesPage.unassigned')}
                                  </span>
                                  {slot.missingReasons.length > 0 && (
                                    <span className="block text-xs opacity-80">
                                      {slot.missingReasons.join(', ')}
                                    </span>
                                  )}
                                </button>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void loadBoard()}
          disabled={loading || running}
          className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          {t('organizer.refereesPage.previewAssignments')}
        </button>
        <button
          type="button"
          onClick={() => void applyPreview()}
          disabled={isReadOnly || running || board?.locked}
          className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
        >
          {running
            ? t('organizer.refereesPage.applying')
            : t('organizer.refereesPage.applyAssignments')}
        </button>
        <button
          type="button"
          onClick={() => void lockAssignments()}
          disabled={isReadOnly || locking || board?.locked}
          className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          {locking
            ? t('organizer.refereesPage.locking')
            : t('organizer.refereesPage.lockAssignments')}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-gray-400">{t('organizer.refereesPage.loading')}</p>
      ) : !board || (board.pools.length === 0 && board.unscheduledPools.length === 0) ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-400 text-sm">
            {t('organizer.refereesPage.noPoolsForAssignments')}
          </p>
        </div>
      ) : (
        <>
          {renderPoolRows(board.pools)}
          {board.unscheduledPools.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-700">
                {t('organizer.refereesPage.unscheduledPools')}
              </h2>
              {renderPoolRows(board.unscheduledPools, true)}
            </div>
          )}
          {board.missingSlots.length > 0 && (
            <div className="border border-red-200 bg-red-50 rounded-lg p-4">
              <p className="text-sm font-semibold text-red-800">
                {t('organizer.refereesPage.missingAssignments')}
              </p>
              <ul className="mt-2 space-y-1 text-sm text-red-700">
                {board.missingSlots.map((missing) => (
                  <li key={`${missing.poolId}:${missing.role}`}>
                    {missing.poolName} - {roleLabel(missing.role)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* R4: back-to-back swap suggestions (engine-computed). Panel
              hides itself when the list is empty. */}
          <SwapSuggestionsPanel
            suggestions={board.swapSuggestions ?? []}
            isReadOnly={isReadOnly}
            busy={running}
            onApply={(s) => void applySwap(s)}
          />
        </>
      )}

      {picker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-lg bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {picker.pool.name} - {picker.slot.displayName ?? roleLabel(picker.slot.role)}
                </h2>
                <p className="text-sm text-gray-500">{picker.pool.tournamentName}</p>
              </div>
              <button
                type="button"
                onClick={() => setPicker(null)}
                className="text-sm text-gray-500 hover:text-gray-800"
              >
                {t('organizer.refereesPage.cancel')}
              </button>
            </div>

            <div className="max-h-96 space-y-4 overflow-y-auto">
              <CandidateGroup
                title={t('organizer.refereesPage.recommendedCandidates')}
                candidates={picker.slot.candidates.recommended}
                onSelect={(candidate) =>
                  void manualAssign(picker.pool.id, picker.slot.role, candidate.personId)
                }
              />
              <CandidateGroup
                title={t('organizer.refereesPage.warningCandidates')}
                candidates={picker.slot.candidates.warning}
                onSelect={(candidate) =>
                  void manualAssign(picker.pool.id, picker.slot.role, candidate.personId)
                }
              />
              <CandidateGroup
                title={t('organizer.refereesPage.blockedCandidates')}
                candidates={picker.slot.candidates.blocked}
                disabled
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

interface GlobalPersonResult {
  id: string;
  given_name: string;
  family_name: string;
  display_name: string;
}

interface PersonResult {
  id: string;
  given_name: string;
  family_name: string;
  club_label: string | null;
  claimed_by_user_id: string | null;
  /**
   * Every participant gets a global_person_id at create time via the
   * persons.service matcher. Nullable here only as a legacy-data
   * safety net; in fresh-deploy practice it's always set.
   */
  global_person_id: string | null;
}

export default function RefereesPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { isReadOnly } = useEventStatus(eventId);
  const [activeTab, setActiveTab] = useState<RefereeWorkspaceTab>('referees');

  useEffect(() => {
    function syncHash() {
      const hash = window.location.hash.replace('#', '');
      if (
        hash === 'assignments' ||
        hash === 'qualifications' ||
        hash === 'referees' ||
        hash === 'staffing'
      ) {
        setActiveTab(hash);
      }
    }
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  function selectTab(tab: RefereeWorkspaceTab) {
    setActiveTab(tab);
    window.history.replaceState(null, '', `#${tab}`);
  }

  // ── Data state ──────────────────────────────────────────────────────────────
  const [skills, setSkills] = useState<RefereeSkill[]>([]);
  const [referees, setReferees] = useState<EventRefereeRow[]>([]);
  const [qualIdMap, setQualIdMap] = useState<QualIdMap>(new Map());
  const [loading, setLoading] = useState(true);
  // Ref (not state) so it does not re-trigger the effect when it flips.
  // Prevents full-table flash on subsequent refetches (refereesKey increments).
  const hasLoadedOnceRef = useRef(false);

  // ── Refresh keys ────────────────────────────────────────────────────────────
  const [skillsKey, setSkillsKey] = useState(0);
  const [refereesKey, setRefereesKey] = useState(0);

  // ── Search state ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<PersonResult[]>([]);

  // ── Saving state ────────────────────────────────────────────────────────────
  const [savingQual, setSavingQual] = useState<string | null>(null);

  // ── Global person link state ────────────────────────────────────────────────
  const [linkingPersonId, setLinkingPersonId] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [globalResults, setGlobalResults] = useState<GlobalPersonResult[]>([]);

  // ── Skill modal state ───────────────────────────────────────────────────────
  // R4: `initial.description` + `isSystem` flow through so the modal
  // can show the description field on both kinds while keeping
  // name/colour read-only on system skills.
  const [skillModal, setSkillModal] = useState<{
    mode: 'add' | 'edit';
    skillId?: string;
    isSystem?: boolean;
    initial?: { name: string; color: string; description?: string };
  } | null>(null);

  // ── Toast ───────────────────────────────────────────────────────────────────
  const toast = useToast();

  // ── Fetch skills catalog ────────────────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventId}/referee-skills`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as RefereeSkill[];
        setSkills(data);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [eventId, apiUrl, skillsKey]);

  // ── Fetch referees (enriched) + qual id map ─────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();
    // Only show the full-page loading skeleton on initial mount.
    // Subsequent refetches (refereesKey increments) keep existing data visible.
    if (!hasLoadedOnceRef.current) setLoading(true);

    Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}/referees`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/referee-qualifications`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([refRes, qualRes]) => {
        setLoading(false);
        hasLoadedOnceRef.current = true;
        if (!refRes.ok || !qualRes.ok) return;

        const refData = (await refRes.json()) as EventRefereeRow[];
        setReferees(refData);

        // Build qual id map: key = `${personId}:${skillId}` → qualId
        // The old endpoint returns records with personId (as person_id) and role (= skillId)
        const rawQuals = (await qualRes.json()) as Array<{
          id: string;
          personId?: string;
          person_id?: string;
          role: string;
        }>;
        const map = new Map<string, string>();
        for (const q of rawQuals) {
          const pid = q.personId ?? q.person_id;
          if (pid) map.set(`${pid}:${q.role}`, q.id);
        }
        setQualIdMap(map);
      })
      .catch((err: unknown) => {
        setLoading(false);
        hasLoadedOnceRef.current = true;
        if (err instanceof Error && err.name === 'AbortError') return;
      });

    return () => controller.abort();
  }, [eventId, apiUrl, refereesKey]);

  // ── Person search ───────────────────────────────────────────────────────────
  // Fires whenever the input has focus. Empty `search` returns all event
  // participants (backend caps at 50) so the operator can pick someone to
  // promote to referee without having to type first.

  useEffect(() => {
    if (!searchFocused) {
      setSearchResults([]);
      return;
    }
    const trimmed = search.trim();
    // For a typed query we still debounce; for the empty-on-focus case we
    // fire immediately so the dropdown shows up as soon as the input opens.
    const controller = new AbortController();
    const delay = trimmed.length === 0 ? 0 : 250;
    const timer = setTimeout(() => {
      const url = trimmed
        ? `${apiUrl}/api/v1/events/${eventId}/persons/lookup?q=${encodeURIComponent(trimmed)}`
        : `${apiUrl}/api/v1/events/${eventId}/persons/lookup`;
      fetch(url, { signal: controller.signal, credentials: 'include' })
        .then(async (res) => {
          if (res.ok) setSearchResults((await res.json()) as PersonResult[]);
        })
        .catch(() => undefined);
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, searchFocused, eventId, apiUrl]);

  // ── Global person search ────────────────────────────────────────────────────

  useEffect(() => {
    if (globalSearch.trim().length < 2) {
      const timer = setTimeout(() => setGlobalResults([]), 0);
      return () => clearTimeout(timer);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`${apiUrl}/api/v1/global-persons?q=${encodeURIComponent(globalSearch)}&roles=referee`, {
        signal: controller.signal,
        credentials: 'include',
      })
        .then(async (res) => {
          if (res.ok) setGlobalResults((await res.json()) as GlobalPersonResult[]);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [globalSearch, apiUrl]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function addReferee(personId: string) {
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/referees/${personId}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        toast.error(t('organizer.refereesPage.addRefereeFailed'));
      }
    } catch {
      toast.error(t('organizer.refereesPage.addRefereeFailed'));
    }
    setRefereesKey((k) => k + 1);
  }

  async function upsertQualification(personId: string, skillId: string, rating: number | null) {
    setSavingQual(`${personId}-${skillId}`);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/referee-qualifications`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ personId, role: skillId, rating }),
      });
      if (!res.ok) {
        toast.error(t('organizer.refereesPage.qualificationSaveFailed'));
      }
      setRefereesKey((k) => k + 1);
    } catch {
      toast.error(t('organizer.refereesPage.qualificationSaveFailed'));
      setRefereesKey((k) => k + 1);
    } finally {
      setSavingQual(null);
    }
  }

  async function removeQualification(personId: string, skillId: string) {
    // Look up the qual UUID from our local map
    const qualId = qualIdMap.get(`${personId}:${skillId}`);
    if (!qualId) {
      // Fallback: refetch in case id map is stale
      setRefereesKey((k) => k + 1);
      return;
    }
    setSavingQual(`${personId}-${skillId}`);
    try {
      const res = await fetch(`${apiUrl}/api/v1/referee-qualifications/${qualId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        toast.error(t('organizer.refereesPage.qualificationRemoveFailed'));
      }
      setRefereesKey((k) => k + 1);
    } catch {
      toast.error(t('organizer.refereesPage.qualificationRemoveFailed'));
      setRefereesKey((k) => k + 1);
    } finally {
      setSavingQual(null);
    }
  }

  /**
   * Delete a custom skill. The backend rejects system skills, and returns
   * 409 with a reason list when the skill is still referenced (by active
   * qualifications and/or staffing slot configs — extended in migration
   * 0060). We surface the reason verbatim so the operator knows what to
   * un-reference before retrying.
   */
  async function deleteSkill(skillId: string) {
    if (!confirm(t('organizer.refereesPage.catalogDeleteConfirm'))) return;
    try {
      const res = await fetch(`${apiUrl}/api/v1/referee-skills/${skillId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        toast.error(body.message ?? t('organizer.refereesPage.catalogDeleteBlocked'));
        return;
      }
      if (!res.ok) {
        toast.error(t('organizer.refereesPage.catalogDeleteFailed'));
        return;
      }
      toast.success(t('organizer.refereesPage.catalogDeleteSuccess'));
      setSkillsKey((k) => k + 1);
      setRefereesKey((k) => k + 1);
    } catch {
      toast.error(t('organizer.refereesPage.catalogDeleteFailed'));
    }
  }

  /**
   * R5: persist a drag-reorder of skills. Re-fetches the catalog so
   * SkillCatalog re-renders in the new order.
   */
  async function reorderSkills(orderedSkillIds: string[]) {
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/referee-skills/reorder`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedSkillIds }),
      });
      if (!res.ok) {
        toast.error(t('organizer.refereesPage.catalogReorderFailed'));
        return;
      }
      setSkillsKey((k) => k + 1);
    } catch {
      toast.error(t('organizer.refereesPage.catalogReorderFailed'));
    }
  }

  async function updateAvailability(
    personId: string,
    patch: { availableAllTournaments?: boolean; availableAllEventDuration?: boolean },
  ) {
    // Optimistic update
    setReferees((prev) =>
      prev.map((r) =>
        r.personId === personId
          ? {
              ...r,
              availableAllTournaments: patch.availableAllTournaments ?? r.availableAllTournaments,
              availableAllEventDuration:
                patch.availableAllEventDuration ?? r.availableAllEventDuration,
            }
          : r,
      ),
    );

    const res = await fetch(
      `${apiUrl}/api/v1/events/${eventId}/referees/${personId}/availability`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      },
    );

    if (!res.ok) {
      // Revert
      setRefereesKey((k) => k + 1);
      toast.error(t('organizer.refereesPage.availabilitySaveFailed'));
    }
  }

  async function linkToGlobalPerson(qualificationId: string, globalPersonId: string) {
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/global-persons/${globalPersonId}/link-referee-qualification`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ qualificationId }),
        },
      );
      if (!res.ok) {
        toast.error(t('organizer.refereesPage.linkProfileFailed'));
      }
    } catch {
      toast.error(t('organizer.refereesPage.linkProfileFailed'));
    }
    setLinkingPersonId(null);
    setGlobalSearch('');
    setGlobalResults([]);
    setRefereesKey((k) => k + 1);
  }

  async function createAndLinkGlobalPerson(ref: EventRefereeRow) {
    const nameParts = ref.displayName.split(' ');
    const givenName = nameParts[0] ?? ref.displayName;
    const familyName = nameParts.slice(1).join(' ') || givenName;
    try {
      const res = await fetch(`${apiUrl}/api/v1/global-persons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          givenName,
          familyName,
          displayName: ref.displayName,
          isReferee: true,
        }),
      });
      if (!res.ok) {
        toast.error(t('organizer.refereesPage.createProfileFailed'));
        setRefereesKey((k) => k + 1);
        return;
      }
      const gp = (await res.json()) as { id: string };
      // Find any qual id for this person
      const firstQualId = Array.from(qualIdMap.entries()).find(([key]) =>
        key.startsWith(`${ref.personId}:`),
      )?.[1];
      if (firstQualId) await linkToGlobalPerson(firstQualId, gp.id);
    } catch {
      toast.error(t('organizer.refereesPage.createProfileFailed'));
      setRefereesKey((k) => k + 1);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <main className="p-8 max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href={`/org/${slug}`} className="hover:text-gray-700">
              {slug}
            </Link>
            <span>/</span>
            <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-gray-700">
              {t('organizer.refereesPage.eventBreadcrumb')}
            </Link>
            <span>/</span>
            <span className="text-gray-900 font-medium">
              {t('organizer.refereesPage.refereesTitle')}
            </span>
          </div>
          <h1 className="text-2xl font-bold">{t('organizer.refereesPage.pageTitle')}</h1>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'qualifications' && (
            <button
              onClick={() => setSkillModal({ mode: 'add' })}
              disabled={isReadOnly}
              title={isReadOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined}
              className="border border-red-300 text-red-700 hover:bg-red-50 font-medium py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              + {t('organizer.refereesPage.addCustomSkill')}
            </button>
          )}
          <Link
            href={`/org/${slug}/events/${eventId}/pools`}
            className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            {t('organizer.refereesPage.backToPools')}
          </Link>
        </div>
      </div>

      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {(['referees', 'qualifications', 'staffing', 'assignments'] as RefereeWorkspaceTab[]).map(
            (tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => selectTab(tab)}
                className={[
                  'border-b-2 px-1 py-3 text-sm font-medium transition-colors',
                  activeTab === tab
                    ? 'border-red-700 text-red-700'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700',
                ].join(' ')}
              >
                {t(`organizer.refereesPage.tabs.${tab}`)}
              </button>
            ),
          )}
        </nav>
      </div>

      {activeTab === 'assignments' ? (
        <AssignmentsTab eventId={eventId} apiUrl={apiUrl} isReadOnly={isReadOnly} />
      ) : activeTab === 'qualifications' ? (
        <SkillCatalog
          skills={skills}
          referees={referees}
          isReadOnly={isReadOnly}
          onReorder={(ids) => void reorderSkills(ids)}
          onEditSkill={(skill) =>
            setSkillModal({
              mode: 'edit',
              skillId: skill.id,
              isSystem: skill.isSystem,
              initial: {
                name: skill.name,
                color: skill.color,
                description: skill.description ?? '',
              },
            })
          }
          onDeleteSkill={(skill) => void deleteSkill(skill.id)}
          onUpsertQualification={(personId, skillId, rating) =>
            void upsertQualification(personId, skillId, rating)
          }
          onRemoveQualification={(personId, skillId) => void removeQualification(personId, skillId)}
        />
      ) : activeTab === 'staffing' ? (
        <StaffingTab eventId={eventId} apiUrl={apiUrl} skills={skills} isReadOnly={isReadOnly} />
      ) : (
        <>
          {/* Add referee search */}
          {activeTab === 'referees' && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6">
              <p className="text-sm font-medium text-gray-700 mb-2">
                {t('organizer.refereesPage.addRefereeButton')}
              </p>
              <div className="relative">
                <input
                  type="search"
                  value={search}
                  disabled={isReadOnly}
                  onChange={(e) => setSearch(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  // Delay so clicks on the result list register before the
                  // dropdown closes; 200ms covers a fast click reliably.
                  onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
                  placeholder={
                    isReadOnly
                      ? t('organizer.deletionRequest.archivedReadOnly')
                      : t('organizer.refereesPage.searchParticipantPlaceholder')
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                {searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                    {searchResults.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                      >
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {p.given_name} {p.family_name}
                          </p>
                          {p.club_label && <p className="text-xs text-gray-400">{p.club_label}</p>}
                        </div>
                        {p.global_person_id ? (
                          <button
                            onClick={() => {
                              void addReferee(p.global_person_id!);
                              setSearch('');
                              setSearchResults([]);
                            }}
                            className="text-xs border border-gray-300 rounded px-2 py-0.5 hover:bg-gray-100"
                          >
                            {t('organizer.refereesPage.addQualification')}
                          </button>
                        ) : (
                          <span
                            title={t('organizer.refereesPage.linkProfileFirst')}
                            className="text-xs text-gray-400 border border-gray-200 rounded px-2 py-0.5 cursor-not-allowed"
                          >
                            {t('organizer.refereesPage.addQualification')}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Referee table.
              On the Qualifications tab we render the header (with the 3
              default skill columns) even when no referees exist yet, so the
              operator can see what skills will be available. The body shows
              an empty-state row instead of hiding the whole table. */}
          {loading ? (
            <p className="text-gray-400 text-sm">{t('organizer.refereesPage.loading')}</p>
          ) : referees.length === 0 ? (
            <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
              <p className="text-gray-400 text-sm">{t('organizer.refereesPage.noReferees')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    {/* Name column */}
                    <th className="py-2 pr-4 font-medium whitespace-nowrap">
                      {t('organizer.refereesPage.personColumn')}
                    </th>

                    {/* Skill columns — the matrix moved from the Qualifications
                        tab onto the Referees tab as part of the R1 staffing
                        overhaul. Qualifications is now a skill catalog. */}
                    {activeTab === 'referees' &&
                      skills.map((skill) => (
                        <th
                          key={skill.id}
                          className={[
                            'py-2 px-3 font-medium text-center whitespace-nowrap rounded-t',
                            tintBgClassFor(skill.color),
                          ].join(' ')}
                        >
                          <div className="flex items-center justify-center gap-1">
                            <span>{skill.name}</span>
                            {!skill.isSystem && (
                              <button
                                onClick={() =>
                                  setSkillModal({
                                    mode: 'edit',
                                    skillId: skill.id,
                                    isSystem: skill.isSystem,
                                    initial: {
                                      name: skill.name,
                                      color: skill.color,
                                      description: skill.description ?? '',
                                    },
                                  })
                                }
                                disabled={isReadOnly}
                                className="text-gray-400 hover:text-gray-700 ml-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
                                title={
                                  isReadOnly
                                    ? t('organizer.deletionRequest.archivedReadOnly')
                                    : t('organizer.refereesPage.editSkill')
                                }
                              >
                                ✎
                              </button>
                            )}
                          </div>
                        </th>
                      ))}

                    {/* Availability columns */}
                    {activeTab === 'referees' && (
                      <>
                        <th className="py-2 px-3 font-medium text-center whitespace-nowrap">
                          {t('organizer.refereesPage.availableAllTournaments')}
                        </th>
                        <th className="py-2 px-3 font-medium text-center whitespace-nowrap">
                          {t('organizer.refereesPage.availableAllEventDuration')}
                        </th>
                      </>
                    )}

                    {/* Assignment summary */}
                    {activeTab === 'referees' && (
                      <th className="py-2 px-3 font-medium whitespace-nowrap">
                        {t('organizer.refereesPage.assignedTo')}
                      </th>
                    )}

                    {/* Total matches */}
                    {activeTab === 'referees' && (
                      <th className="py-2 px-3 font-medium text-center whitespace-nowrap">
                        {t('organizer.refereesPage.totalMatches')}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {/* The Qualifications-tab empty-state row used to live here.
                      With the catalog rewrite the qualifications branch
                      short-circuits above and never reaches this table,
                      so the row is no longer reachable. */}
                  {referees.map((ref) => (
                    <tr key={ref.personId} className="border-b border-gray-100 hover:bg-gray-50">
                      {/* Name cell */}
                      <td className="py-3 pr-4 align-top">
                        <p className="font-medium text-gray-900">{ref.displayName}</p>
                        {ref.clubLabel && <p className="text-xs text-gray-400">{ref.clubLabel}</p>}
                        {ref.personId ? (
                          <span className="text-xs text-emerald-600 font-medium">
                            {t('organizer.refereesPage.globalProfileLinked')}
                          </span>
                        ) : (
                          <div className="mt-1">
                            {linkingPersonId === ref.personId ? (
                              <div className="flex flex-col gap-1">
                                <input
                                  type="search"
                                  value={globalSearch}
                                  onChange={(e) => setGlobalSearch(e.target.value)}
                                  placeholder={t(
                                    'organizer.refereesPage.searchGlobalPersonsPlaceholder',
                                  )}
                                  className="border border-gray-300 rounded px-2 py-1 text-xs w-48 focus:outline-none focus:ring-1 focus:ring-amber-500"
                                />
                                {globalResults.length > 0 && (
                                  <div className="bg-white border border-gray-200 rounded shadow text-xs max-h-32 overflow-y-auto">
                                    {globalResults.map((gp) => (
                                      <button
                                        key={gp.id}
                                        onClick={() => {
                                          // Find any qual id for this user
                                          const firstQualId = Array.from(qualIdMap.entries()).find(
                                            ([key]) => key.startsWith(`${ref.personId}:`),
                                          )?.[1];
                                          if (firstQualId)
                                            void linkToGlobalPerson(firstQualId, gp.id);
                                        }}
                                        className="block w-full text-left px-2 py-1 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                                      >
                                        {gp.display_name}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => void createAndLinkGlobalPerson(ref)}
                                    className="text-xs text-amber-600 hover:text-amber-800"
                                  >
                                    {t('organizer.refereesPage.createGlobalProfile')}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setLinkingPersonId(null);
                                      setGlobalSearch('');
                                      setGlobalResults([]);
                                    }}
                                    className="text-xs text-gray-400 hover:text-gray-600"
                                  >
                                    {t('organizer.refereesPage.cancel')}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => setLinkingPersonId(ref.personId)}
                                className="text-xs text-amber-600 hover:text-amber-800"
                              >
                                {t('organizer.refereesPage.linkGlobalProfile')}
                              </button>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Skill cells — relocated from Qualifications to Referees in R1. */}
                      {activeTab === 'referees' &&
                        skills.map((skill) => {
                          const qual = ref.qualifications.find((q) => q.skillId === skill.id);
                          const isSaving = savingQual === `${ref.personId}-${skill.id}`;
                          return (
                            <td key={skill.id} className="py-3 px-3 text-center align-top">
                              {qual ? (
                                <div className="flex flex-col items-center gap-1">
                                  <SkillBadge color={skill.color} label={skill.name} />
                                  <StarRating
                                    value={qual.rating}
                                    onChange={(v) => {
                                      if (!isReadOnly && ref.personId) {
                                        void upsertQualification(ref.personId, skill.id, v);
                                      }
                                    }}
                                  />
                                  <button
                                    onClick={() => {
                                      if (ref.personId) {
                                        void removeQualification(ref.personId, skill.id);
                                      }
                                    }}
                                    disabled={isSaving || isReadOnly}
                                    title={
                                      isReadOnly
                                        ? t('organizer.deletionRequest.archivedReadOnly')
                                        : undefined
                                    }
                                    className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50"
                                  >
                                    {t('organizer.refereesPage.removeQualification')}
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => {
                                    if (ref.personId) {
                                      void upsertQualification(ref.personId, skill.id, null);
                                    }
                                  }}
                                  disabled={isSaving || !ref.personId || isReadOnly}
                                  className="text-xs text-gray-400 hover:text-gray-600 border border-dashed border-gray-300 rounded px-2 py-0.5 disabled:opacity-50"
                                  title={
                                    isReadOnly
                                      ? t('organizer.deletionRequest.archivedReadOnly')
                                      : !ref.personId
                                        ? t('organizer.refereesPage.linkProfileFirst')
                                        : undefined
                                  }
                                >
                                  {t('organizer.refereesPage.addQualification')}
                                </button>
                              )}
                            </td>
                          );
                        })}

                      {/* Available all tournaments toggle */}
                      {activeTab === 'referees' && (
                        <td className="py-3 px-3 text-center align-middle">
                          <div className="flex justify-center">
                            <Toggle
                              checked={ref.availableAllTournaments}
                              disabled={isReadOnly}
                              onChange={(v) =>
                                void updateAvailability(ref.personId, {
                                  availableAllTournaments: v,
                                })
                              }
                            />
                          </div>
                        </td>
                      )}

                      {/* Available all event duration toggle */}
                      {activeTab === 'referees' && (
                        <td className="py-3 px-3 text-center align-middle">
                          <div className="flex justify-center">
                            <Toggle
                              checked={ref.availableAllEventDuration}
                              disabled={isReadOnly}
                              onChange={(v) =>
                                void updateAvailability(ref.personId, {
                                  availableAllEventDuration: v,
                                })
                              }
                            />
                          </div>
                        </td>
                      )}

                      {/* Assignment summary cell */}
                      {activeTab === 'referees' && (
                        <td className="py-3 px-3 align-top">
                          {ref.assignments.length === 0 ? (
                            <span className="text-xs text-gray-400">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {ref.assignments.slice(0, 3).map((a) => (
                                <span
                                  key={a.tournamentId}
                                  className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 rounded px-2 py-0.5"
                                >
                                  {a.tournamentName}
                                  <span className="text-gray-400">·</span>
                                  {a.matchCount}{' '}
                                  {a.matchCount === 1
                                    ? t('organizer.refereesPage.match')
                                    : t('organizer.refereesPage.matches')}
                                </span>
                              ))}
                              {ref.assignments.length > 3 && (
                                <span
                                  className="text-xs text-gray-500 cursor-default"
                                  title={ref.assignments
                                    .slice(3)
                                    .map(
                                      (a) =>
                                        `${a.tournamentName} · ${a.matchCount} ${a.matchCount === 1 ? t('organizer.refereesPage.match') : t('organizer.refereesPage.matches')}`,
                                    )
                                    .join(', ')}
                                >
                                  {t('organizer.refereesPage.moreCount', {
                                    count: ref.assignments.length - 3,
                                  })}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      )}

                      {/* Total matches */}
                      {activeTab === 'referees' && (
                        <td className="py-3 px-3 text-center align-middle">
                          <span className="font-medium text-gray-900">{ref.totalMatchCount}</span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Skill modal */}
      {skillModal && (
        <SkillModal
          mode={skillModal.mode}
          skillId={skillModal.skillId}
          isSystem={skillModal.isSystem}
          initial={skillModal.initial}
          eventId={eventId}
          apiUrl={apiUrl}
          onClose={() => setSkillModal(null)}
          onSaved={() => {
            setSkillModal(null);
            setSkillsKey((k) => k + 1);
            setRefereesKey((k) => k + 1);
          }}
          onDeleted={() => {
            setSkillModal(null);
            setSkillsKey((k) => k + 1);
            setRefereesKey((k) => k + 1);
          }}
        />
      )}
    </main>
  );
}
