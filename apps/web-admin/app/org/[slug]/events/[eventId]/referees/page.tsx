'use client';

/**
 * Referee admin — T-906 (rework)
 * Route: /org/[slug]/events/[eventId]/referees
 *
 * Dynamic skill columns, per-row availability toggles, assignment summary.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ConfirmDialog, Modal, SkillBadge, tintBgClassFor, useToast } from '@myclash/ui';

import { DEFAULT_EVENT_TIMEZONE, localeToBcp47, type AppLocale } from '@myclash/time';
import { blockTint, resolveBlockAccent } from '@myclash/types';
import type { CapacityWarning, RefereeConflict } from '@myclash/types';
import { useI18n, type Translator } from '@myclash/next-i18n/client';
import { useEventStatus } from '../_hooks/useEventStatus';
import { SkillCatalog } from './_components/SkillCatalog';
import { StaffingTab } from './_components/StaffingTab';
import { SwapSuggestionsPanel } from './_components/SwapSuggestionsPanel';
import { AssignmentDiagnosticsPanel, type RuleKey } from './_components/AssignmentDiagnosticsPanel';
import { PoolSlotCard } from './_components/PoolSlotCard';
import { groupPoolsByTimeslot } from './_components/group-pools-by-timeslot';
import { NO_LICE, liceColumnsFor } from './_components/timeslot-lice-columns';
import {
  eventDayIsosFor,
  filterBoardPools,
  tournamentsForDay,
} from './_components/filter-board-pools';
import { AssignmentFilters } from './_components/AssignmentFilters';
import {
  PoolTimelineGrid,
  type TimelineBreak,
  type TimelinePool,
} from '../pools/_tabs/_components/PoolTimelineGrid';
import { AvailabilityChips } from './_components/AvailabilityChips';
import { countQualifiedBySkill } from './count-qualified-by-skill';
import { programmeBlockStartIso } from './_components/programme-block-instant';
import { getPublicApiUrl } from '@/lib/api-url';

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
  /** Slice 6: per-event hidden flag. Hidden skills disappear from list
   *  columns and the role picker; existing qualifications are inert. */
  isHidden?: boolean;
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
  /** Slice 8: per-tournament allowlist. Empty array = no restriction set. */
  tournamentIds: string[];
  /** Slice 8: per-day allowlist. Empty array = no restriction set. */
  dayIndices: number[];
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
    /**
     * True when the chip is from the engine but not yet persisted —
     * the operator hasn't clicked Apply. Renders with the dashed
     * "Proposed" style.
     */
    isProposal: boolean;
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
  kind?: 'pool' | 'swiss' | 'bracket' | 'finals';
  /**
   * Present when kind !== 'pool': the match ids this unit wraps. One for a
   * bracket/finals card, every bout of the (round × piste) for a Swiss card.
   */
  matchIds?: string[];
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
  conflicts: RefereeConflict[];
  capacityWarnings: CapacityWarning[];
  deadEndSlots: Array<{ poolId: string; poolName: string; role: string }>;
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
  const { t } = useI18n();

  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => onChange(value === star ? null : star)}
          className={[
            'text-lg leading-none transition-colors',
            // gold-text clears the WCAG 1.4.11 3:1 floor for non-text glyphs;
            // plain --color-gold sits at 2.06:1 on light.
            (value ?? 0) >= star ? 'text-gold-text' : 'text-muted',
          ].join(' ')}
          title={t('organizer.refereesPage.ratingTooltip', { star })}
        >
          ★
        </button>
      ))}
    </div>
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
  const { t } = useI18n();

  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? 'blue');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message || t('organizer.refereesPage.skillSaveFailed'));
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
    <Modal
      open
      onClose={onClose}
      busy={saving || deleting}
      size="md"
      title={
        mode === 'add'
          ? t('organizer.refereesPage.addCustomSkill')
          : t('organizer.refereesPage.editSkill')
      }
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div>
            {mode === 'edit' && (
              <button
                onClick={() => void handleDelete()}
                disabled={deleting || saving}
                className="text-sm text-danger hover:text-danger-hover border border-danger/30 rounded-lg px-3 py-1.5 disabled:opacity-50"
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
              className="text-sm text-foreground-secondary border border-border rounded-lg px-4 py-1.5 hover:bg-background disabled:opacity-50"
            >
              {t('organizer.refereesPage.cancel')}
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving || deleting || !name.trim()}
              className="text-sm text-accent-foreground bg-accent hover:bg-accent-hover rounded-lg px-4 py-1.5 disabled:opacity-50"
            >
              {saving ? t('organizer.refereesPage.saving') : t('organizer.refereesPage.save')}
            </button>
          </div>
        </div>
      }
    >
      {error && (
        <div className="mb-3 text-sm text-danger bg-danger/10 border border-danger/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-1">
            {t('organizer.refereesPage.skillName')}
          </label>
          <input
            type="text"
            value={name}
            disabled={isSystem}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ring-accent disabled:bg-background disabled:text-muted"
            placeholder={t('organizer.refereesPage.skillNamePlaceholder')}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-1">
            {t('organizer.refereesPage.skillColor')}
          </label>
          <select
            value={color}
            disabled={isSystem}
            onChange={(e) => setColor(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ring-accent disabled:bg-background disabled:text-muted"
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
          <label className="block text-sm font-medium text-foreground-secondary mb-1">
            {t('organizer.refereesPage.skillDescription')}
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={3}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ring-accent"
            placeholder={t('organizer.refereesPage.skillDescriptionPlaceholder')}
          />
        </div>
      </div>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

// Takes the translator: this is module scope, where no hook can run, and the
// module-level `t` is permanently English.
function roleLabel(t: Translator, role: AssignmentRole, skillNameById?: Map<string, string>) {
  // Resolution chain (per the "don't display IDs to humans" rule):
  //   1. operator-typed skill name from referee_skills.name
  //   2. legacy hand-written translation for built-in roles
  //   3. raw role string as a dev-only last resort — operators should
  //      never normally see this.
  const known = ['arbitre_declarant', 'arbitre_assesseur', 'arbitre_table'];
  const skillName = skillNameById?.get(role);
  if (skillName) return skillName;
  if (known.includes(role)) return t(`organizer.eventCompensation.roles.${role}`);
  return role;
}

function formatTime(t: Translator, value: string | null, locale: AppLocale) {
  if (!value) return t('organizer.refereesPage.unscheduled');
  return new Intl.DateTimeFormat(localeToBcp47(locale), {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

/** Short day label for the by-timeslot header + day-filter pills. */
function formatDayShort(value: string, locale: AppLocale) {
  return new Intl.DateTimeFormat(localeToBcp47(locale), {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(value));
}

/**
 * Per-bout spacing of a multi-match unit, in minutes, so a drag re-fans it at
 * the cadence it already runs at instead of the server's 5-minute default.
 *
 * `scheduledEnd` is "last start + the inferred interval", so the window spans
 * exactly N intervals for N bouts. Null when it cannot be derived — the server
 * then picks its own default.
 */
function unitMatchDurationMinutes(pool: {
  matchIds?: string[];
  scheduledStart: string | null;
  scheduledEnd: string | null;
}): number | null {
  const count = pool.matchIds?.length ?? 0;
  if (count < 1 || !pool.scheduledStart || !pool.scheduledEnd) return null;
  const spanMs = new Date(pool.scheduledEnd).getTime() - new Date(pool.scheduledStart).getTime();
  if (!Number.isFinite(spanMs) || spanMs <= 0) return null;
  return Math.max(1, Math.round(spanMs / count / 60_000));
}

/**
 * Map a backend blocked-candidate reason code to a user-friendly i18n
 * string. Known codes are emitted by assignment-board.service.ts ~L1183:
 *   - 'missing_qualification' → not qualified for this role
 *   - 'fighter_referee_overlap' → competing in this pool
 * Unknown codes fall through verbatim so a new server reason still
 * shows something the operator can grep on.
 */
const KNOWN_BLOCKED_REASONS = new Set([
  'missing_qualification',
  'fighter_referee_overlap',
  'schedule_conflict',
  'unavailable',
  'duplicate_role_same_pool',
]);

function formatBlockedReason(t: Translator, code: string): string {
  if (KNOWN_BLOCKED_REASONS.has(code)) {
    return t(`organizer.refereesPage.blockedReasons.${code}`);
  }
  return code;
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
  const { t } = useI18n();

  if (candidates.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase text-muted">{title}</p>
      <div className="space-y-2">
        {candidates.map((candidate) => {
          const reasonsRaw = candidate.reasons ?? [];
          const formattedReasons = reasonsRaw.map((code) => formatBlockedReason(t, code));
          const tooltip =
            disabled && formattedReasons.length > 0 ? formattedReasons.join(', ') : undefined;
          return (
            <button
              type="button"
              key={candidate.personId}
              disabled={disabled}
              onClick={() => onSelect?.(candidate)}
              title={tooltip}
              className={[
                'w-full rounded border px-3 py-2 text-left text-sm transition-colors',
                disabled
                  ? 'cursor-not-allowed border-border bg-background text-muted'
                  : 'border-border hover:border-border',
              ].join(' ')}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={[
                    'block font-medium',
                    disabled ? 'line-through decoration-muted decoration-1' : '',
                  ].join(' ')}
                >
                  {candidate.displayName}
                </span>
                {disabled && (
                  <span className="rounded bg-border px-1.5 py-0.5 text-[10px] font-semibold uppercase text-foreground-secondary">
                    {t('organizer.refereesPage.unavailableBadge')}
                  </span>
                )}
              </div>
              {candidate.clubLabel && <span className="block text-xs">{candidate.clubLabel}</span>}
              {formattedReasons.length > 0 && (
                <span
                  className={[
                    'mt-0.5 block text-xs italic',
                    disabled ? 'text-muted' : 'text-foreground-secondary',
                  ].join(' ')}
                >
                  {formattedReasons.join(', ')}
                </span>
              )}
              {(candidate.warnings?.length ?? 0) > 0 && (
                <span className="block text-xs">{candidate.warnings?.join(', ')}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AssignmentsTab({
  eventId,
  apiUrl,
  isReadOnly,
  skillNameById,
  skillColorById,
}: {
  eventId: string;
  apiUrl: string;
  isReadOnly: boolean;
  /**
   * Resolves a slot's role (a skill id) back to the operator-typed name.
   * Falls back through roleLabel() if missing — see the rule documented
   * in feedback_no_raw_ids_in_ui.md.
   */
  skillNameById: Map<string, string>;
  /** Per-skill colour token for the chip tint (see assignment-chip-classes). */
  skillColorById: Map<string, string>;
}) {
  const { locale, t } = useI18n();
  const [board, setBoard] = useState<AssignmentBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True iff at least one slot's chip is from the engine but not
  // yet saved. Drives the visibility of Apply + Clear preview.
  const hasProposals = useMemo(() => {
    if (!board) return false;
    for (const pool of [...board.pools, ...board.unscheduledPools]) {
      for (const slot of pool.roleSlots) {
        if (slot.assignment?.isProposal) return true;
      }
    }
    return false;
  }, [board]);
  // Scheduling conflicts keyed by `${poolId}|${personId}` so a role cell can
  // flag the assigned referee in red. Excludes the 'unavailable' kind, which
  // is surfaced in the health panel rather than per-cell.
  const conflictByKey = useMemo(() => {
    const m = new Map<string, RefereeConflict>();
    for (const c of board?.conflicts ?? []) {
      if (c.kind !== 'unavailable') m.set(`${c.poolId}|${c.personId}`, c);
    }
    return m;
  }, [board]);
  const [picker, setPicker] = useState<{
    pool: AssignmentBoardPool;
    slot: AssignmentBoardRoleSlot;
  } | null>(null);
  // pool.liceId is already populated by the assignment-board backend
  // (derived from matches[0].lice_id). The lice's human name lives on
  // the lices table; fetch the list once and build an id → name map so
  // the pool rows can render the operator-typed label.
  const [liceNameById, setLiceNameById] = useState<Map<string, string>>(() => new Map());
  // ConfirmDialog state — replaces the native window.confirm() prompts
  // so the destructive flows use the app's styled dialog (matches the
  // rest of admin).
  const [pendingClearAll, setPendingClearAll] = useState(false);
  const [pendingClearPool, setPendingClearPool] = useState<{ id: string; name: string } | null>(
    null,
  );
  // Unscheduled pool whose full card is expanded under the timeline
  // (clicking its chip toggles it; one at a time).
  const [expandedPoolId, setExpandedPoolId] = useState<string | null>(null);
  // Programme blocks (breaks / admin / workshop — NOT the competition runs,
  // which are the pool/bracket cards) so the timeline shows the day's shape.
  const [programmeBlocks, setProgrammeBlocks] = useState<
    Array<{
      id: string;
      dayIndex: number;
      blockType: string;
      label: string;
      startTime: string;
      endTime: string;
    }>
  >([]);
  // The event's own date span. The day filter's chip list is derived from it
  // AND from where the board's units really sit — see eventDayIsos below.
  const [eventStartDateIso, setEventStartDateIso] = useState<string | null>(null);
  const [eventEndDateIso, setEventEndDateIso] = useState<string | null>(null);
  /** The clock the day filter is measured on — see the pool filter below. */
  const [eventTz, setEventTz] = useState<string>(DEFAULT_EVENT_TIMEZONE);
  const [selectedDayIso, setSelectedDayIso] = useState<string | null>(null);
  /**
   * Tournament filter. `null` means "untouched", which resolves to every
   * tournament the selected day has — so the default needs no effect to set
   * it, and picking a day just resets this back to null. An explicit array
   * (including an EMPTY one, which shows nothing) means the operator chose.
   */
  const [tournamentSelection, setTournamentSelection] = useState<string[] | null>(null);
  // Drag-drop: ref holds the dragged pool (no re-render); state highlights
  // the hovered drop cell.
  const dragPool = useRef<{
    id: string;
    matchIds: string[];
    /** Per-bout spacing of the dragged unit, so a re-fan keeps its cadence. */
    matchDurationMinutes: number | null;
    liceId: string | null;
    scheduledStart: string | null;
  } | null>(null);
  const [dragOverCell, setDragOverCell] = useState<{ blockStart: string; liceId: string } | null>(
    null,
  );

  // Timeslot blocks + lice columns for the "by time slot" card grid.
  // The lice column order mirrors the /lices fetch order (sort_order) —
  // liceNameById is built by insertion, so its key order carries it.
  const allBoardPools = useMemo(
    () => (board ? [...board.pools, ...board.unscheduledPools] : []),
    [board],
  );
  // The day chips. The union with the board matters: a unit scheduled outside
  // the event's own dates used to be reachable only under "All days", because
  // the chips came from the event record and the cards came from the board.
  const eventDayIsos = useMemo(
    () => eventDayIsosFor(eventStartDateIso, eventEndDateIso, allBoardPools, eventTz),
    [eventStartDateIso, eventEndDateIso, allBoardPools, eventTz],
  );
  // The tournaments the day filter currently offers, and the ids actually in
  // force — see `tournamentSelection` for why null resolves to "all of them".
  const tournamentOptions = useMemo(
    () => tournamentsForDay(allBoardPools, selectedDayIso, eventTz),
    [allBoardPools, selectedDayIso, eventTz],
  );
  const selectedTournamentIds = useMemo(
    () => tournamentSelection ?? tournamentOptions.map((option) => option.id),
    [tournamentSelection, tournamentOptions],
  );
  // Day + tournament filter, scoping the timeline AND the by-timeslot grid
  // below it. The day is measured on the event's clock, never the browser's:
  // `scheduledStart` is a real UTC instant, and the programme-block rows beside
  // these are built from a day INDEX, so on an event west of UTC a `slice(0,10)`
  // made the two halves of one filter disagree about which day they were on.
  // Unscheduled pools (null start) only appear under "All days".
  const visibleBoardPools = useMemo(
    () =>
      filterBoardPools(allBoardPools, {
        dayIso: selectedDayIso,
        tz: eventTz,
        tournamentIds: selectedTournamentIds,
      }),
    [allBoardPools, selectedDayIso, eventTz, selectedTournamentIds],
  );
  const { blocks: timeslotBlocks, unscheduled: unscheduledBoardPools } = useMemo(
    () => groupPoolsByTimeslot(visibleBoardPools),
    [visibleBoardPools],
  );
  const liceColumns = useMemo(
    () => liceColumnsFor(timeslotBlocks, [...liceNameById.keys()]),
    [timeslotBlocks, liceNameById],
  );
  const timelinePools = useMemo<TimelinePool[]>(
    () =>
      visibleBoardPools.map((p) => ({
        id: p.id,
        name: p.name,
        tournamentId: p.tournamentId,
        tournamentName: p.tournamentName,
        scheduledStart: p.scheduledStart,
        scheduledEnd: p.scheduledEnd,
        liceName: p.liceId ? (liceNameById.get(p.liceId) ?? null) : null,
        filledSlotCount: p.roleSlots.filter((s) => s.assignment !== null).length,
        totalSlotCount: p.roleSlots.length,
      })),
    [visibleBoardPools, liceNameById],
  );
  // Non-competition programme blocks placed on the same epoch as pools, so
  // they interleave with the timeslot rows; filtered to the selected day.
  const breakItems = useMemo(() => {
    if (!eventStartDateIso) return [];
    return programmeBlocks
      .map((b) => {
        const startIso = programmeBlockStartIso(b, eventStartDateIso);
        return {
          id: b.id,
          startIso,
          startMs: new Date(startIso).getTime(),
          dayIso: startIso.slice(0, 10),
          label: `${b.label} (${b.startTime}–${b.endTime})`,
          kind: b.blockType,
        };
      })
      .filter((it) => (selectedDayIso ? it.dayIso === selectedDayIso : true))
      .sort((a, b) => a.startMs - b.startMs);
  }, [programmeBlocks, eventStartDateIso, selectedDayIso]);
  const timelineBreaks = useMemo<TimelineBreak[]>(
    () => breakItems.map((b) => ({ startIso: b.startIso, label: b.label, kind: b.kind })),
    [breakItems],
  );
  const expandedPool = useMemo(
    () => unscheduledBoardPools.find((p) => p.id === expandedPoolId) ?? null,
    [unscheduledBoardPools, expandedPoolId],
  );

  // Picking a day drops any tournament choice made on the previous one: a
  // tournament hidden on Saturday must not open Sunday already hidden. Done
  // here rather than in an effect — react-hooks/set-state-in-effect is an
  // error in this app.
  function handleSelectDay(iso: string | null) {
    setSelectedDayIso(iso);
    setTournamentSelection(null);
  }

  // Toggling materialises the effective list first, so the first click off
  // "all" keeps every other tournament on.
  function handleToggleTournament(id: string) {
    setTournamentSelection(
      selectedTournamentIds.includes(id)
        ? selectedTournamentIds.filter((current) => current !== id)
        : [...selectedTournamentIds, id],
    );
  }

  // Timeline chip click: unscheduled chips toggle their expanded card;
  // scheduled chips jump to their timeslot section.
  function handleChipClick(chip: TimelinePool) {
    if (!chip.scheduledStart) {
      setExpandedPoolId((prev) => (prev === chip.id ? null : chip.id));
      return;
    }
    const block = timeslotBlocks.find((b) => b.pools.some((p) => p.id === chip.id));
    if (block) {
      document
        .getElementById(`timeslot-${block.startTime}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // Drag-drop a pool card onto a (timeslot row × lice column) cell: move the
  // whole card to that lice + start time. Three shapes:
  //   - real pool          → POST /pools/:id/reschedule (shifts all its matches)
  //   - bracket/finals     → PATCH /matches/:id/schedule (exactly one match)
  //   - Swiss round×piste  → POST /programme/schedule-group, mode 'pool'
  //     (several bouts, no `pools` row to reschedule). That endpoint already
  //     means "keep this group on one lice, appended after what's there", which
  //     is exactly the Swiss unit's semantics — no Swiss-specific route needed.
  /** The one request that moves the dragged card, per its shape. */
  function postPoolMove(
    dragged: NonNullable<typeof dragPool.current>,
    liceId: string | null,
    blockStartIso: string,
  ): Promise<Response> {
    const json = { 'Content-Type': 'application/json' };
    if (dragged.matchIds.length > 1) {
      return fetch(`${apiUrl}/api/v1/events/${eventId}/programme/schedule-group`, {
        method: 'POST',
        credentials: 'include',
        headers: json,
        body: JSON.stringify({
          matchIds: dragged.matchIds,
          liceIds: [liceId],
          startTime: blockStartIso,
          mode: 'pool',
          ...(dragged.matchDurationMinutes
            ? { matchDurationMinutes: dragged.matchDurationMinutes }
            : {}),
        }),
      });
    }
    const singleMatchId = dragged.matchIds[0];
    if (singleMatchId) {
      return fetch(`${apiUrl}/api/v1/matches/${singleMatchId}/schedule`, {
        method: 'PATCH',
        credentials: 'include',
        headers: json,
        body: JSON.stringify({ liceId, scheduledAt: blockStartIso }),
      });
    }
    return fetch(`${apiUrl}/api/v1/pools/${dragged.id}/reschedule`, {
      method: 'POST',
      credentials: 'include',
      headers: json,
      body: JSON.stringify({ liceId, startAtIso: blockStartIso }),
    });
  }

  async function handlePoolDrop(targetLiceId: string, blockStartIso: string) {
    const dragged = dragPool.current;
    dragPool.current = null;
    setDragOverCell(null);
    if (!dragged || isReadOnly || board?.locked) return;
    const liceId = targetLiceId === NO_LICE ? null : targetLiceId;
    if ((dragged.liceId ?? null) === liceId && dragged.scheduledStart === blockStartIso) return;
    // schedule-group needs a target lice; there is no "unschedule" through it.
    if (dragged.matchIds.length > 1 && liceId === null) return;
    setRunning(true);
    setError(null);
    try {
      const res = await postPoolMove(dragged, liceId, blockStartIso);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.refereesPage.assignmentLoadFailed'));
      }
      await loadBoard();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('organizer.refereesPage.assignmentLoadFailed'),
      );
      await loadBoard();
    } finally {
      setRunning(false);
    }
  }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the event/API changes; loadBoard identity is stable for these deps
  }, [eventId, apiUrl]);

  // Fetch the lice list once for id → name resolution in the table.
  // Quietly tolerates errors — the column just shows "—" if the
  // endpoint is unavailable.
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiUrl}/api/v1/events/${eventId}/lices`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const lices = (await res.json()) as Array<{ id: string; name: string }>;
        const map = new Map<string, string>();
        for (const l of lices) map.set(l.id, l.name);
        setLiceNameById(map);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [eventId, apiUrl]);

  // Event days (for the day filter + day labels) + programme blocks (breaks,
  // admin, workshop) so the timeline mirrors the day's shape. Both tolerate
  // errors quietly — the views just render without days / without breaks.
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiUrl}/api/v1/events/${eventId}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const ev = (await res.json()) as {
          start_date: string;
          end_date?: string | null;
          timezone?: string | null;
        };
        setEventStartDateIso(ev.start_date ?? null);
        setEventEndDateIso(ev.end_date ?? null);
        setEventTz(ev.timezone ?? DEFAULT_EVENT_TIMEZONE);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [eventId, apiUrl]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiUrl}/api/v1/events/${eventId}/programme`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const blocks = (await res.json()) as Array<{
          id: string;
          dayIndex: number;
          blockType: string;
          label: string;
          startTime: string;
          endTime: string;
        }>;
        // Competition blocks are the pool/bracket runs already shown as
        // cards; keep only the surrounding non-competition blocks.
        setProgrammeBlocks(blocks.filter((b) => b.blockType !== 'competition'));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [eventId, apiUrl]);

  // Per-rule toggles (health panel checkboxes) — persisted in the event's
  // pool-assignment-settings; the board re-loads after a toggle so
  // conflicts / candidate blocking re-evaluate against the new rule set.
  const [ruleSettings, setRuleSettings] = useState<Record<RuleKey, boolean> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiUrl}/api/v1/events/${eventId}/pool-assignment-settings`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const s = (await res.json()) as Record<RuleKey, boolean>;
        setRuleSettings({
          enableOwnPoolRule: s.enableOwnPoolRule ?? true,
          enableOfficiateVsFightRule: s.enableOfficiateVsFightRule ?? true,
          enableDoubleBookedRule: s.enableDoubleBookedRule ?? true,
          enableTwoRolesRule: s.enableTwoRolesRule ?? true,
          enableAvailabilityRule: s.enableAvailabilityRule ?? true,
          enableCapacityRule: s.enableCapacityRule ?? true,
        });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [eventId, apiUrl]);

  async function toggleRule(key: RuleKey, enabled: boolean) {
    const prev = ruleSettings;
    setRuleSettings((cur) => (cur ? { ...cur, [key]: enabled } : cur));
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/pool-assignment-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ [key]: enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadBoard();
    } catch {
      setRuleSettings(prev ?? null);
      setError(t('organizer.refereesPage.rules.toggleFailed'));
    }
  }

  /**
   * Run the auto-assign engine and overlay its proposals on the
   * current board. Until the operator clicks this, the board only
   * shows persisted assignments — no engine work happens on mount.
   */
  async function previewAutoAssign() {
    setPreviewing(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/events/${eventId}/referee-assignment-board/preview`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.refereesPage.previewFailed'));
      }
      setBoard((await res.json()) as AssignmentBoard);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.refereesPage.previewFailed'));
    } finally {
      setPreviewing(false);
    }
  }

  /** Discard the on-screen proposals by reloading the persisted board. */
  async function clearPreview() {
    await loadBoard();
  }

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
      // After Apply, re-fetch the persisted-only board so the
      // dashed proposal chips become solid persisted chips.
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

  /** Remove one assignment from its slot (the card's Unassign button) —
   *  same DELETE the pools-tab card uses, then a board refresh. */
  async function unassign(assignmentId: string) {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/referee-assignments/${assignmentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
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
   * Slice 7a of the referees overhaul: reverse the lock so the operator
   * can edit a confirmed board again. Confirmation dialog stays out of
   * scope here — `setError` surfaces backend failure via the existing
   * banner so the operator still sees the result.
   */
  async function clearAllAssignments() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/referee-assignments`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.refereesPage.clearFailed'));
      }
      await loadBoard();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.refereesPage.clearFailed'));
    } finally {
      setRunning(false);
    }
  }

  async function clearPoolAssignments(poolId: string) {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/pools/${poolId}/referee-assignments`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.refereesPage.clearFailed'));
      }
      await loadBoard();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.refereesPage.clearFailed'));
    } finally {
      setRunning(false);
    }
  }

  async function unlockAssignments() {
    setLocking(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/unlock-referee-assignments`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.refereesPage.assignmentUnlockFailed'));
      }
      await loadBoard();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('organizer.refereesPage.assignmentUnlockFailed'),
      );
    } finally {
      setLocking(false);
    }
  }

  /** One pool card wired to this tab's picker / unassign / clear / conflict state. */
  function renderPoolCard(pool: AssignmentBoardPool, showLice: boolean) {
    return (
      <PoolSlotCard
        key={pool.id}
        pool={pool}
        liceName={pool.liceId ? (liceNameById.get(pool.liceId) ?? null) : null}
        showLice={showLice}
        isReadOnly={isReadOnly || !!board?.locked}
        busy={running}
        skillNameById={skillNameById}
        skillColorById={skillColorById}
        onAssignClick={(slot) => setPicker({ pool, slot })}
        onUnassign={(assignmentId) => void unassign(assignmentId)}
        conflictFor={(personId) => conflictByKey.get(`${pool.id}|${personId}`)}
        onClearPool={() => setPendingClearPool({ id: pool.id, name: pool.name })}
      />
    );
  }

  /**
   * "By time slot" grid: every pool/bracket (any tournament) running at
   * the same time renders side-by-side, one column per lice, so the
   * operator staffs a whole time block at once. Replaces the per-
   * tournament tables — the timeline above gives the overview, the
   * cards carry the assignment controls.
   */
  function renderTimeslotSections() {
    if (timeslotBlocks.length === 0) return null;
    const canDrag = !isReadOnly && !board?.locked;
    // Interleave timeslot rows with non-competition programme blocks
    // (breaks / admin / workshop), ordered by start time.
    const rows: Array<
      | { kind: 'slot'; ms: number; block: (typeof timeslotBlocks)[number] }
      | { kind: 'break'; ms: number; brk: (typeof breakItems)[number] }
    > = [
      ...timeslotBlocks.map((block) => ({
        kind: 'slot' as const,
        ms: new Date(block.startTime).getTime(),
        block,
      })),
      ...breakItems.map((brk) => ({ kind: 'break' as const, ms: brk.startMs, brk })),
    ].sort((a, b) => a.ms - b.ms);
    return (
      <div className="space-y-6">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
          {t('organizer.refereesPage.byTimeslotTitle')}
        </h3>
        {rows.map((row) =>
          row.kind === 'break' ? (
            <div
              key={`break-${row.brk.id}`}
              // breakItems carries no colorHex, so these bars always show the
              // kind's default accent — same resolution as the schedule board.
              style={blockTint(resolveBlockAccent(row.brk.kind, null))}
              className="flex items-center justify-center rounded-md border-y px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-foreground-secondary"
            >
              {row.brk.label}
            </div>
          ) : (
            <div
              key={row.block.startTime}
              id={`timeslot-${row.block.startTime}`}
              className="scroll-mt-4 space-y-2"
            >
              <div className="flex items-baseline gap-3">
                <span className="text-sm font-bold tabular-nums text-foreground">
                  {formatDayShort(row.block.startTime, locale)} ·{' '}
                  {formatTime(t, row.block.startTime, locale)}
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="overflow-x-auto pb-2">
                <div
                  className="grid gap-3"
                  style={{
                    gridTemplateColumns: `repeat(${liceColumns.length}, minmax(240px, 1fr))`,
                  }}
                >
                  {liceColumns.map((liceId) => {
                    const cellPools = row.block.pools.filter(
                      (p) => (p.liceId ?? NO_LICE) === liceId,
                    );
                    const isDropTarget =
                      dragOverCell?.blockStart === row.block.startTime &&
                      dragOverCell?.liceId === liceId;
                    return (
                      <div
                        key={liceId}
                        onDragOver={
                          canDrag
                            ? (e) => {
                                e.preventDefault();
                                if (!isDropTarget)
                                  setDragOverCell({ blockStart: row.block.startTime, liceId });
                              }
                            : undefined
                        }
                        onDragLeave={
                          canDrag ? () => isDropTarget && setDragOverCell(null) : undefined
                        }
                        onDrop={
                          canDrag
                            ? () => void handlePoolDrop(liceId, row.block.startTime)
                            : undefined
                        }
                        className={[
                          'space-y-2 rounded-lg',
                          isDropTarget ? 'ring-2 ring-indigo-400 ring-offset-1' : '',
                        ].join(' ')}
                      >
                        <p className="text-center text-[11px] font-semibold uppercase tracking-wider text-muted">
                          {liceId === NO_LICE
                            ? t('organizer.refereesPage.noLiceColumn')
                            : (liceNameById.get(liceId) ?? '—')}
                        </p>
                        {cellPools.length === 0 ? (
                          <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted">
                            {t('organizer.refereesPage.idleLice')}
                          </p>
                        ) : (
                          cellPools.map((pool) => (
                            <div
                              key={pool.id}
                              draggable={canDrag}
                              onDragStart={() => {
                                dragPool.current = {
                                  id: pool.id,
                                  matchIds: pool.matchIds ?? [],
                                  matchDurationMinutes: unitMatchDurationMinutes(pool),
                                  liceId: pool.liceId ?? null,
                                  scheduledStart: pool.scheduledStart,
                                };
                              }}
                              onDragEnd={() => {
                                dragPool.current = null;
                              }}
                              className={canDrag ? 'cursor-grab active:cursor-grabbing' : ''}
                            >
                              {renderPoolCard(pool, false)}
                            </div>
                          ))
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ),
        )}
      </div>
    );
  }

  // One owner for the lock dimming, applied to the two wrappers that sandwich
  // the filter card.
  const lockedDimClass = board?.locked ? 'pointer-events-none opacity-60' : '';

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void previewAutoAssign()}
          disabled={loading || running || previewing || isReadOnly || board?.locked}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
        >
          {previewing
            ? t('organizer.refereesPage.previewingState')
            : t('organizer.refereesPage.previewAutoAssign')}
        </button>
        {hasProposals && (
          <>
            <button
              type="button"
              onClick={() => void applyPreview()}
              disabled={isReadOnly || running || board?.locked}
              className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
            >
              {running
                ? t('organizer.refereesPage.applying')
                : t('organizer.refereesPage.applyAutoAssign')}
            </button>
            <button
              type="button"
              onClick={() => void clearPreview()}
              disabled={running || previewing}
              className="border border-border hover:border-border text-foreground-secondary font-medium py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {t('organizer.refereesPage.clearPreview')}
            </button>
          </>
        )}
        {board?.locked ? (
          <button
            type="button"
            onClick={() => void unlockAssignments()}
            disabled={isReadOnly || locking}
            className="border border-warning/30 bg-warning/10 hover:border-warning text-warning font-medium py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {locking
              ? t('organizer.refereesPage.unlocking')
              : t('organizer.refereesPage.unlockAssignments')}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void lockAssignments()}
            disabled={isReadOnly || locking}
            className="border border-border hover:border-border text-foreground-secondary font-medium py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {locking
              ? t('organizer.refereesPage.locking')
              : t('organizer.refereesPage.lockAssignments')}
          </button>
        )}
        <button
          type="button"
          onClick={() => setPendingClearAll(true)}
          disabled={isReadOnly || running || board?.locked}
          className="border border-danger/30 text-danger hover:border-danger hover:bg-danger/10 font-medium py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          {t('organizer.refereesPage.clearAll')}
        </button>
        <button
          type="button"
          onClick={() => void loadBoard()}
          disabled={loading}
          className="border border-border hover:border-border text-foreground-secondary font-medium py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          {t('organizer.refereesPage.healthcheck')}
        </button>
        {board && board.conflicts.length > 0 && (
          <button
            type="button"
            onClick={() =>
              document
                .getElementById('referee-health-panel')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-sm font-semibold text-danger transition-colors hover:border-danger hover:bg-danger/10"
          >
            <span aria-hidden="true">⚠</span>
            {t('organizer.refereesPage.conflict.checkButton').replace(
              '{count}',
              String(board.conflicts.length),
            )}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {loading ? (
        <p className="text-sm text-muted">{t('organizer.refereesPage.loading')}</p>
      ) : !board || (board.pools.length === 0 && board.unscheduledPools.length === 0) ? (
        <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
          <p className="text-muted text-sm">{t('organizer.refereesPage.noPoolsForAssignments')}</p>
        </div>
      ) : (
        <>
          {/* Slice A: when the board is locked, render a banner above
              the grid and grey out everything below it so the operator
              has an unmistakable signal. The Lock/Unlock buttons stay
              live above this wrapper.
              The dimming is in TWO wrappers with the filter card between
              them, undimmed: locking freezes assignments, not looking, and
              this tab calls itself a read-only view. Splitting it here keeps
              the order on screen — health, filters, timeline — unchanged. */}
          {board.locked && (
            <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning">
              <span aria-hidden="true">🔒</span>
              <span>{t('organizer.refereesPage.lockedBanner')}</span>
            </div>
          )}
          <div className={lockedDimClass} aria-disabled={board.locked || undefined}>
            <div id="referee-health-panel" className="scroll-mt-4">
              <AssignmentDiagnosticsPanel
                board={board}
                skillNameById={skillNameById}
                roleLabel={(role) => roleLabel(t, role, skillNameById)}
                {...(ruleSettings ? { ruleSettings } : {})}
                onToggleRule={(key, enabled) => void toggleRule(key, enabled)}
                togglesDisabled={isReadOnly || running || previewing}
              />
            </div>
          </div>
          {/* Day + tournament filter — scopes the timeline and the
              by-timeslot view below. Stays live on a locked board. */}
          <AssignmentFilters
            days={eventDayIsos.map((iso) => ({ iso, label: formatDayShort(iso, locale) }))}
            selectedDayIso={selectedDayIso}
            onSelectDay={handleSelectDay}
            tournaments={tournamentOptions}
            selectedTournamentIds={selectedTournamentIds}
            onToggleTournament={handleToggleTournament}
            onSelectAllTournaments={() => setTournamentSelection(null)}
          />
          <div
            className={['space-y-4', lockedDimClass].join(' ').trim()}
            aria-disabled={board.locked || undefined}
          >
            {/* Event-wide timeline: every pool/bracket chip grouped by start
                time, with the UNSCHEDULED chip row. Unscheduled chips expand
                their card below; scheduled chips jump to their timeslot. */}
            <PoolTimelineGrid
              pools={timelinePools}
              breaks={timelineBreaks}
              onPoolClick={handleChipClick}
            />
            {expandedPool && (
              <div className="rounded-xl border-2 border-dashed border-border bg-background p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                    {t('organizer.refereesPage.unscheduled')}
                  </p>
                  <button
                    type="button"
                    onClick={() => setExpandedPoolId(null)}
                    className="text-xs text-muted hover:text-foreground"
                  >
                    {t('organizer.refereesPage.collapseCard')}
                  </button>
                </div>
                <div className="max-w-md">{renderPoolCard(expandedPool, true)}</div>
              </div>
            )}
            {renderTimeslotSections()}
            {/* R4: back-to-back swap suggestions (engine-computed).
                Panel hides itself when the list is empty. */}
            <SwapSuggestionsPanel
              suggestions={board.swapSuggestions ?? []}
              isReadOnly={isReadOnly}
              busy={running}
              onApply={(s) => void applySwap(s)}
            />
          </div>
        </>
      )}

      {picker && (
        <Modal
          open
          onClose={() => setPicker(null)}
          size="lg"
          title={`${picker.pool.name} - ${
            picker.slot.displayName ?? roleLabel(t, picker.slot.role, skillNameById)
          }`}
          description={picker.pool.tournamentName}
          footer={
            <button
              type="button"
              onClick={() => setPicker(null)}
              className="text-sm text-muted hover:text-foreground"
            >
              {t('organizer.refereesPage.cancel')}
            </button>
          }
        >
          <div className="space-y-4">
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
        </Modal>
      )}

      <ConfirmDialog
        open={pendingClearAll}
        title={t('organizer.refereesPage.clearAllConfirmTitle')}
        description={t('organizer.refereesPage.clearAllConfirm')}
        confirmLabel={t('organizer.refereesPage.clearAllConfirmAction')}
        cancelLabel={t('organizer.refereesPage.cancel')}
        danger
        busy={running}
        onCancel={() => setPendingClearAll(false)}
        onConfirm={() => {
          setPendingClearAll(false);
          void clearAllAssignments();
        }}
      />

      <ConfirmDialog
        open={pendingClearPool !== null}
        title={t('organizer.refereesPage.clearPoolConfirmTitle')}
        description={
          pendingClearPool
            ? t('organizer.refereesPage.clearPoolConfirm').replace(
                '{poolName}',
                pendingClearPool.name,
              )
            : ''
        }
        confirmLabel={t('organizer.refereesPage.clearPoolConfirmAction')}
        cancelLabel={t('organizer.refereesPage.cancel')}
        danger
        busy={running}
        onCancel={() => setPendingClearPool(null)}
        onConfirm={() => {
          if (pendingClearPool) {
            const id = pendingClearPool.id;
            setPendingClearPool(null);
            void clearPoolAssignments(id);
          }
        }}
      />
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
  const { locale, t } = useI18n();
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = getPublicApiUrl();
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
  /** Slice 8: list of tournaments on the event — feeds the per-tournament
   *  availability chip column. Fetched once on mount. */
  const [eventTournaments, setEventTournaments] = useState<Array<{ id: string; name: string }>>([]);
  /** Slice 8: list of day indices on the event — feeds the per-day
   *  availability chip column. Derived from event.start_date / end_date. */
  const [eventDays, setEventDays] = useState<Array<{ index: number; label: string }>>([]);
  const [qualIdMap, setQualIdMap] = useState<QualIdMap>(new Map());
  const [loading, setLoading] = useState(true);
  // ConfirmDialog state for destructive skill delete (replaces native confirm).
  const [pendingDeleteSkill, setPendingDeleteSkill] = useState<{
    id: string;
    name: string;
  } | null>(null);
  /**
   * id → human name lookup for resolving a slot's role (a skill id) back
   * to the operator-typed name. Fed into roleLabel() at every assignment
   * render site so custom skills never surface as raw ids like
   * `custom-bed9d10f-a1b2c3`.
   */
  /** Slice 6: skills the operator hasn't hidden — drives list columns,
   *  the role picker, and the chip-colour Map. The catalog still gets the
   *  full list so it can render the un-hide toggle for hidden rows. */
  const visibleSkills = useMemo(() => skills.filter((s) => !s.isHidden), [skills]);
  const skillNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const skill of visibleSkills) {
      if (skill.name) map.set(skill.id, skill.name);
    }
    return map;
  }, [visibleSkills]);
  const skillColorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const skill of visibleSkills) {
      if (skill.color) map.set(skill.id, skill.color);
    }
    return map;
  }, [visibleSkills]);
  // Ref (not state) so it does not re-trigger the effect when it flips.
  // Prevents full-table flash on subsequent refetches (refereesKey increments).
  const hasLoadedOnceRef = useRef(false);

  // ── Refresh keys ────────────────────────────────────────────────────────────
  const [skillsKey, setSkillsKey] = useState(0);
  const [refereesKey, setRefereesKey] = useState(0);

  // Count of qualified referees per skill — fuels the badge in each
  // role column header on the Referees sub-tab.
  const qualifiedCountBySkill = useMemo(() => countQualifiedBySkill(referees), [referees]);

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

  // Slice 8: tournaments + event days for the availability chip columns.
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([tRes, eRes]) => {
        if (tRes.ok) {
          const data = (await tRes.json()) as Array<{ id: string; name: string }>;
          setEventTournaments(data.map((t) => ({ id: t.id, name: t.name })));
        }
        if (eRes.ok) {
          // Events endpoint returns snake_case start_date / end_date.
          const ev = (await eRes.json()) as { start_date: string; end_date?: string | null };
          const start = new Date(`${ev.start_date}T00:00:00.000Z`);
          const end = ev.end_date ? new Date(`${ev.end_date}T00:00:00.000Z`) : start;
          const days: Array<{ index: number; label: string }> = [];
          const cursor = new Date(start);
          let idx = 0;
          while (cursor.getTime() <= end.getTime()) {
            days.push({
              index: idx,
              label: cursor.toLocaleDateString(localeToBcp47(locale), {
                weekday: 'short',
                day: 'numeric',
              }),
            });
            cursor.setUTCDate(cursor.getUTCDate() + 1);
            idx += 1;
          }
          setEventDays(days);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [eventId, apiUrl, locale]);

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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale search results when the input loses focus
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
   * Slice 6: hide / un-hide a skill for this event. The backend
   * upserts (or deletes) a row in event_hidden_skills — works for
   * system skills too, scoped per event.
   */
  async function toggleSkillVisibility(skill: RefereeSkill, nextHidden: boolean) {
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/events/${eventId}/referee-skills/${skill.id}/visibility`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isHidden: nextHidden }),
        },
      );
      if (!res.ok) {
        toast.error(t('organizer.refereesPage.catalogVisibilityFailed'));
        return;
      }
      setSkillsKey((k) => k + 1);
    } catch {
      toast.error(t('organizer.refereesPage.catalogVisibilityFailed'));
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
    patch: {
      availableAllTournaments?: boolean;
      availableAllEventDuration?: boolean;
      tournamentIds?: string[];
      dayIndices?: number[];
    },
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
              tournamentIds: patch.tournamentIds ?? r.tournamentIds,
              dayIndices: patch.dayIndices ?? r.dayIndices,
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
          <div className="flex items-center gap-2 text-sm text-muted mb-1">
            <Link href={`/org/${slug}`} className="hover:text-foreground-secondary">
              {slug}
            </Link>
            <span>/</span>
            <Link
              href={`/org/${slug}/events/${eventId}`}
              className="hover:text-foreground-secondary"
            >
              {t('organizer.refereesPage.eventBreadcrumb')}
            </Link>
            <span>/</span>
            <span className="text-foreground font-medium">
              {t('organizer.refereesPage.refereesTitle')}
            </span>
          </div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl">
            {t('organizer.refereesPage.pageTitle')}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'qualifications' && (
            <button
              onClick={() => setSkillModal({ mode: 'add' })}
              disabled={isReadOnly}
              title={isReadOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined}
              className="border border-accent text-accent hover:bg-accent/10 font-medium py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              + {t('organizer.refereesPage.addCustomSkill')}
            </button>
          )}
          <Link
            href={`/org/${slug}/events/${eventId}/pools`}
            className="border border-border hover:border-border text-foreground-secondary font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            {t('organizer.refereesPage.backToPools')}
          </Link>
        </div>
      </div>

      <div className="mb-6 border-b border-border">
        <nav className="-mb-px flex gap-6">
          {(['referees', 'assignments', 'qualifications', 'staffing'] as RefereeWorkspaceTab[]).map(
            (tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => selectTab(tab)}
                className={[
                  'border-b-2 px-1 py-3 text-sm font-medium transition-colors',
                  activeTab === tab
                    ? 'border-accent text-accent'
                    : 'border-transparent text-muted hover:border-border hover:text-foreground-secondary',
                ].join(' ')}
              >
                {t(`organizer.refereesPage.tabs.${tab}`)}
              </button>
            ),
          )}
        </nav>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-foreground-secondary">
        {t(`organizer.refereesPage.tabIntros.${activeTab}`)}
      </p>

      {activeTab === 'assignments' ? (
        <AssignmentsTab
          eventId={eventId}
          apiUrl={apiUrl}
          isReadOnly={isReadOnly}
          skillNameById={skillNameById}
          skillColorById={skillColorById}
        />
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
          onDeleteSkill={(skill) => setPendingDeleteSkill({ id: skill.id, name: skill.name })}
          onUpsertQualification={(personId, skillId, rating) =>
            void upsertQualification(personId, skillId, rating)
          }
          onRemoveQualification={(personId, skillId) => void removeQualification(personId, skillId)}
          onToggleVisibility={(skill, nextHidden) => void toggleSkillVisibility(skill, nextHidden)}
        />
      ) : activeTab === 'staffing' ? (
        <StaffingTab eventId={eventId} apiUrl={apiUrl} skills={skills} isReadOnly={isReadOnly} />
      ) : (
        <>
          {/* Add referee search */}
          {activeTab === 'referees' && (
            <div className="bg-background border border-border rounded-xl p-4 mb-6">
              <p className="text-sm font-medium text-foreground-secondary mb-2">
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
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ring-accent disabled:opacity-50 disabled:cursor-not-allowed"
                />
                {searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                    {searchResults.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between px-3 py-2 hover:bg-background border-b border-border last:border-0"
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {p.given_name} {p.family_name}
                          </p>
                          {p.club_label && <p className="text-xs text-muted">{p.club_label}</p>}
                        </div>
                        <button
                          onClick={() => {
                            // Backend accepts either a global_persons.id OR an
                            // event-scoped persons.id — see ensureEventReferee.
                            // Falling back to p.id lets participants without
                            // a cached global_person_id still be added.
                            void addReferee(p.global_person_id ?? p.id);
                            setSearch('');
                            setSearchResults([]);
                          }}
                          className="text-xs border border-border rounded px-2 py-0.5 hover:bg-background"
                        >
                          {t('organizer.refereesPage.addQualification')}
                        </button>
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
            <p className="text-muted text-sm">{t('organizer.refereesPage.loading')}</p>
          ) : referees.length === 0 ? (
            <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
              <p className="text-muted text-sm">{t('organizer.refereesPage.noReferees')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border text-left text-muted">
                    {/* Name column */}
                    <th className="py-2 pr-4 font-medium whitespace-nowrap">
                      {t('organizer.refereesPage.personColumn')} ({referees.length})
                    </th>

                    {/* Skill columns — the matrix moved from the Qualifications
                        tab onto the Referees tab as part of the R1 staffing
                        overhaul. Qualifications is now a skill catalog. */}
                    {activeTab === 'referees' &&
                      visibleSkills.map((skill) => (
                        <th
                          key={skill.id}
                          className={[
                            'py-2 px-3 font-medium text-center whitespace-nowrap rounded-t',
                            tintBgClassFor(skill.color),
                          ].join(' ')}
                        >
                          <div className="flex items-center justify-center gap-1">
                            <span>{skill.name}</span>
                            <span
                              className="rounded-full bg-surface/70 px-1.5 py-0.5 text-[10px] font-semibold text-foreground-secondary"
                              title={t('organizer.refereesPage.catalogColCount')}
                            >
                              {qualifiedCountBySkill.get(skill.id) ?? 0}
                            </span>
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
                                className="text-muted hover:text-foreground-secondary ml-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
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

                    {/* Availability columns — Slice 8: granular chip picker
                        per tournament + per day instead of two booleans. */}
                    {activeTab === 'referees' && (
                      <>
                        <th className="py-2 px-3 font-medium text-center whitespace-nowrap">
                          {t('organizer.refereesPage.availableTournamentsColumn')}
                        </th>
                        <th className="py-2 px-3 font-medium text-center whitespace-nowrap">
                          {t('organizer.refereesPage.availableDaysColumn')}
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
                    <tr key={ref.personId} className="border-b border-border hover:bg-background">
                      {/* Name cell */}
                      <td className="py-3 pr-4 align-top">
                        <p className="font-medium text-foreground">{ref.displayName}</p>
                        {ref.clubLabel && <p className="text-xs text-muted">{ref.clubLabel}</p>}
                        {ref.personId ? (
                          <span className="text-xs text-success font-medium">
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
                                  className="border border-border rounded px-2 py-1 text-xs w-48 focus:outline-none focus:ring-1 ring-accent"
                                />
                                {globalResults.length > 0 && (
                                  <div className="bg-surface border border-border rounded shadow text-xs max-h-32 overflow-y-auto">
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
                                        className="block w-full text-left px-2 py-1 hover:bg-background border-b border-border last:border-0"
                                      >
                                        {gp.display_name}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => void createAndLinkGlobalPerson(ref)}
                                    className="text-xs text-gold-text hover:text-warning"
                                  >
                                    {t('organizer.refereesPage.createGlobalProfile')}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setLinkingPersonId(null);
                                      setGlobalSearch('');
                                      setGlobalResults([]);
                                    }}
                                    className="text-xs text-muted hover:text-foreground-secondary"
                                  >
                                    {t('organizer.refereesPage.cancel')}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => setLinkingPersonId(ref.personId)}
                                className="text-xs text-gold-text hover:text-warning"
                              >
                                {t('organizer.refereesPage.linkGlobalProfile')}
                              </button>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Skill cells — relocated from Qualifications to Referees in R1. */}
                      {activeTab === 'referees' &&
                        visibleSkills.map((skill) => {
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
                                    className="text-xs text-danger hover:text-danger-hover disabled:opacity-50"
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
                                  className="text-xs text-muted hover:text-foreground-secondary border border-dashed border-border rounded px-2 py-0.5 disabled:opacity-50"
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

                      {/* Slice 8: per-tournament chip picker. */}
                      {activeTab === 'referees' && (
                        <td className="py-3 px-3 align-middle">
                          <AvailabilityChips
                            options={eventTournaments.map((t) => ({
                              value: t.id,
                              label: t.name,
                            }))}
                            selected={ref.tournamentIds}
                            disabled={isReadOnly}
                            allLabel={t('organizer.refereesPage.availableAllTournamentsShort')}
                            onChange={(ids) =>
                              void updateAvailability(ref.personId, { tournamentIds: ids })
                            }
                          />
                        </td>
                      )}

                      {/* Slice 8: per-day chip picker. */}
                      {activeTab === 'referees' && (
                        <td className="py-3 px-3 align-middle">
                          <AvailabilityChips
                            options={eventDays.map((d) => ({
                              value: d.index,
                              label: d.label,
                            }))}
                            selected={ref.dayIndices}
                            disabled={isReadOnly}
                            allLabel={t('organizer.refereesPage.availableAllDaysShort')}
                            onChange={(indices) =>
                              void updateAvailability(ref.personId, { dayIndices: indices })
                            }
                          />
                        </td>
                      )}

                      {/* Assignment summary cell */}
                      {activeTab === 'referees' && (
                        <td className="py-3 px-3 align-top">
                          {ref.assignments.length === 0 ? (
                            <span className="text-xs text-muted">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {ref.assignments.slice(0, 3).map((a) => (
                                <span
                                  key={a.tournamentId}
                                  className="inline-flex items-center gap-1 text-xs bg-border text-foreground-secondary rounded px-2 py-0.5"
                                >
                                  {a.tournamentName}
                                  <span className="text-muted">·</span>
                                  {a.matchCount}{' '}
                                  {a.matchCount === 1
                                    ? t('organizer.refereesPage.match')
                                    : t('organizer.refereesPage.matches')}
                                </span>
                              ))}
                              {ref.assignments.length > 3 && (
                                <span
                                  className="text-xs text-muted cursor-default"
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
                          <span className="font-medium text-foreground">{ref.totalMatchCount}</span>
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

      <ConfirmDialog
        open={pendingDeleteSkill !== null}
        title={t('organizer.refereesPage.catalogDeleteConfirmTitle')}
        description={
          pendingDeleteSkill
            ? t('organizer.refereesPage.catalogDeleteConfirm').replace(
                '{name}',
                pendingDeleteSkill.name,
              )
            : ''
        }
        confirmLabel={t('organizer.refereesPage.catalogDeleteConfirmAction')}
        cancelLabel={t('organizer.refereesPage.cancel')}
        danger
        onCancel={() => setPendingDeleteSkill(null)}
        onConfirm={() => {
          if (pendingDeleteSkill) {
            const id = pendingDeleteSkill.id;
            setPendingDeleteSkill(null);
            void deleteSkill(id);
          }
        }}
      />
    </main>
  );
}
