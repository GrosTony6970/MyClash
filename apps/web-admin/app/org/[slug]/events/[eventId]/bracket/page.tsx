'use client';

/**
 * Bracket management — T-704 / auto-advance
 * Route: /org/[slug]/events/[eventId]/bracket
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  BracketView,
  HelpTooltip,
  MedalPodium,
  Modal,
  TournamentColorDot,
  fuzzyMatch,
  type BracketSlotData,
  type BracketConfig,
  type ColorToken,
  type PodiumData,
} from '@myclash/ui';
import { useRealtimeWithFallback } from '@/lib/supabase-browser';
import { rulesetHelp } from '@/components/rulesets/rulesetHelp';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import { useEventStatus } from '../_hooks/useEventStatus';
import { RefereesTab as BracketRefereesTab } from './_tabs/RefereesTab';
import { buildMatchScoringHref } from '../pools/_tabs/build-scoring-href';
import { diffRoleAssignments } from './diff-role-assignments';
import { deriveDoubleElimPodium } from './derive-de-podium';
import {
  DoubleElimPodiumOptions,
  podiumFromBracket,
  podiumPayload,
  type PodiumOptionsValue,
} from './DoubleElimPodiumOptions';
import { getPublicApiUrl } from '@/lib/api-url';

interface Tournament {
  id: string;
  name: string;
  color?: string | null;
}

interface BracketResult {
  phaseId: string;
  phaseType?: string;
  visibility?: 'hidden' | 'published';
  bracketSize: number;
  fighterCount: number;
  byeCount: number;
  playInMatchCount?: number;
  hasPlayInRound?: boolean;
  rounds: number;
  wbRounds?: number | null;
  lbRounds?: number | null;
  autoAdvance?: boolean;
  grandFinalReset?: boolean;
  secondChanceTarget?: 'gold' | 'bronze';
  bronzeMatch?: boolean;
  repechageEntrySize?: number | null;
  repechageEntryRound?: number | null;
  seedingStrategy?: string;
  bronzeSlotId?: string | null;
  totalSlots: number;
  slots: BracketSlotData[];
  /**
   * `true` when every pool of this tournament reports
   * `status === 'completed'`, OR when the tournament has no pool
   * phase at all (straight-to-bracket). Mirrors the server-side
   * gate `populateBracket` enforces, so the auto-populate button
   * can disable + warn before the click instead of catching a 409
   * after.
   */
  poolsCompleted?: boolean;
  /**
   * Whether this tournament has a pool phase configured at all.
   * When false, populateBracket falls through to the
   * registration-seed branch — the FE shows a confirm dialog
   * before that click so the operator doesn't accidentally seed
   * from the registration list when they expected pools to drive
   * the bracket.
   */
  hasPoolPhase?: boolean;
}

interface OverrideModalState {
  slotId: string;
  /** The slot's scheduled match (null when fighters aren't placed yet) — gates
   *  the Lice + referee controls, which act on the match. */
  matchId: string | null;
  /**
   * Tri-state values:
   *   - undefined: untouched in this modal session, omitted from the PATCH.
   *   - null: explicit clear (sends `registrationAId: null`).
   *   - string: registration UUID to assign.
   */
  regAId: string | null | undefined;
  regBId: string | null | undefined;
  /** Editable lice, initialised to the match's current lice (null = none). */
  liceId: string | null;
  /** Roles the operator changed: role → person id (null = clear). */
  roleChanges: Record<string, string | null>;
}

/**
 * Subset of the /tournaments/:id/registrations payload the bracket
 * override modal needs. The endpoint also returns `persons` and
 * `global_persons` embeds; we project just the bits the picker
 * renders so the JSON stays small.
 */
interface PickerRegistration {
  id: string;
  displayName: string;
  bibNumber: number | null;
  seed: number | null;
}

interface EventLice {
  id: string;
  name: string;
}

/** Minimal slice of the referee assignment board the bracket edit modal needs:
 *  per-match role slots with their current assignee + candidate referees. */
interface RefBoardCandidate {
  personId: string | null;
  displayName: string;
}
interface RefBoardRoleSlot {
  role: string;
  displayName: string | null;
  allowedSkillIds: string[];
  assignment: { personId: string | null; displayName: string } | null;
  candidates: {
    recommended: RefBoardCandidate[];
    warning: RefBoardCandidate[];
    blocked: RefBoardCandidate[];
  };
}
interface RefBoardPool {
  /** One entry for a bracket/finals unit; a whole (round × piste) for Swiss. */
  matchIds?: string[];
  roleSlots: RefBoardRoleSlot[];
}
interface RefBoard {
  pools: RefBoardPool[];
}

/** Event referee skills — id → operator-given name, used to label role slots
 *  with a human name instead of the raw skill id. */
interface RefereeSkill {
  id: string;
  name: string | null;
  color?: string | null;
}

type SeedingStrategy = 'snake' | 'by-rating' | 'random' | 'by-pool-rank';

const MAX_BRACKET_SIZE = 128;
const BRACKET_SIZE_OPTIONS = [4, 8, 16, 32, 64, 128];
const SEEDING_STRATEGIES: SeedingStrategy[] = ['snake', 'by-rating', 'random', 'by-pool-rank'];

// ── R5: tab shell ─────────────────────────────────────────────────────────────
// The bracket page was historically a flat layout. R5 adds a `Referees`
// tab next to the existing bracket UI so operators can staff bracket /
// finals matches in-context. The bracket grid + all its modals live
// under the 'bracket' tab; the new RefereesTab consumes the assignment
// board filtered to this tournament's bracket matches.

type BracketTabKey = 'bracket' | 'referees';

const BRACKET_TABS: Array<{ key: BracketTabKey; labelKey: string }> = [
  { key: 'bracket', labelKey: 'organizer.bracketPage.tabs.bracket' },
  { key: 'referees', labelKey: 'organizer.bracketPage.tabs.referees' },
];

function readBracketHashTab(): BracketTabKey {
  if (typeof window === 'undefined') return 'bracket';
  const hash = window.location.hash.replace('#', '');
  return BRACKET_TABS.find((tab) => tab.key === hash)?.key ?? 'bracket';
}

export default function BracketPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const router = useRouter();
  const searchParams = useSearchParams();
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();
  const { isReadOnly } = useEventStatus(eventId);

  // ── R5: tab state ─────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<BracketTabKey>('bracket');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read initial tab from the URL hash on mount
    setActiveTab(readBracketHashTab());
    function onHash() {
      setActiveTab(readBracketHashTab());
    }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  function selectTab(key: BracketTabKey) {
    // eslint-disable-next-line react-hooks/immutability -- navigating via the URL hash is an intentional external side effect
    window.location.hash = `#${key}`;
  }

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  // Seed the selection from `?tournamentId=...` so refresh + shared
  // links land on the same bracket. We fall back to the first
  // tournament below once the tournaments fetch settles.
  const initialTournamentId = searchParams.get('tournamentId') ?? '';
  const [selectedTournament, setSelectedTournament] = useState<string>(initialTournamentId);
  const [bracket, setBracket] = useState<BracketResult | null>(null);
  const [bracketPhaseId, setBracketPhaseId] = useState<string | null>(null);
  const [existingBracket, setExistingBracket] = useState(false);
  const [redColor, setRedColor] = useState<ColorToken>('red');
  const [blueColor, setBlueColor] = useState<ColorToken>('blue');
  const [tournamentWeapon, setTournamentWeapon] = useState<string | null>(null);

  // Config
  const [qualifyCount, setQualifyCount] = useState<number | ''>('');
  const [bracketSize, setBracketSize] = useState<number | ''>('');
  const [phaseType, setPhaseType] = useState<'single_elim' | 'double_elim'>('single_elim');
  const [seedingStrategy, setSeedingStrategy] = useState<SeedingStrategy>('snake');
  // Double-elim podium model. `grandFinalReset` lives in here rather than as a
  // standalone flag because it is only meaningful in gold mode — the API
  // rejects the pairing, so the form has to hold them together.
  const [newPodium, setNewPodium] = useState<PodiumOptionsValue>({
    secondChanceTarget: 'gold',
    grandFinalReset: false,
    bronzeMatch: true,
    repechageEntrySize: null,
  });

  // Override modal
  const [overrideModal, setOverrideModal] = useState<OverrideModalState | null>(null);
  const [overriding, setOverriding] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  // Inline forfeit modal — opened from the WO chip on a bracket card.
  // Posts to /matches/:id/forfeit so the operator doesn't have to leave
  // the bracket page for the common "Red couldn't make it" case.
  type ForfeitReason =
    | 'voluntary'
    | 'injury'
    | 'black_card_1'
    | 'black_card_2'
    | 'conduct_violation';
  // Forfeit draft — lives inside the ✎ edit modal (no separate forfeit modal).
  const [forfeitSide, setForfeitSide] = useState<'red' | 'blue' | null>(null);
  const [forfeitReason, setForfeitReason] = useState<ForfeitReason>('voluntary');
  const [forfeitBusy, setForfeitBusy] = useState(false);
  const [forfeitError, setForfeitError] = useState<string | null>(null);

  function resetForfeitDraft() {
    setForfeitSide(null);
    setForfeitReason('voluntary');
    setForfeitError(null);
  }

  async function submitForfeit() {
    const matchId = overrideModal?.matchId;
    if (!matchId || !forfeitSide) return;
    const slot = bracket?.slots.find((s) => s.id === overrideModal.slotId);
    const forfeitingRegistrationId =
      forfeitSide === 'red' ? slot?.redRegistrationId : slot?.blueRegistrationId;
    if (!forfeitingRegistrationId) {
      setForfeitError(t('admin.common.sideNoRegistrationYet'));
      return;
    }
    setForfeitBusy(true);
    setForfeitError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}/forfeit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          forfeitingRegistrationId,
          reason: forfeitReason,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      resetForfeitDraft();
      setOverrideModal(null);
      setPickerFilter('');
      refreshBracket();
    } catch (err) {
      setForfeitError(err instanceof Error ? err.message : t('admin.common.forfeitFailed'));
    } finally {
      setForfeitBusy(false);
    }
  }
  /**
   * Registrations for the picker inside the override modal. Loaded once
   * per selected tournament so opening the modal is instant and we
   * don't double-fetch when a row is reassigned.
   */
  const [pickerRegistrations, setPickerRegistrations] = useState<PickerRegistration[]>([]);
  // Event lices (drives the lice pill on each fight + the edit-modal dropdown)
  // and the referee assignment board (per-match role slots for the modal).
  const [lices, setLices] = useState<EventLice[]>([]);
  const [refereeBoard, setRefereeBoard] = useState<RefBoard | null>(null);
  const [refereeSkills, setRefereeSkills] = useState<RefereeSkill[]>([]);
  const [pickerFilter, setPickerFilter] = useState('');

  // Configuration card (post-generation edit)
  const [editPodium, setEditPodium] = useState<PodiumOptionsValue>({
    secondChanceTarget: 'gold',
    grandFinalReset: false,
    bronzeMatch: true,
    repechageEntrySize: null,
  });
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // Re-seed modal
  const [reseedOpen, setReseedOpen] = useState(false);
  const [reseedStrategy, setReseedStrategy] = useState<SeedingStrategy>('snake');
  const [reseedRunning, setReseedRunning] = useState(false);
  const [reseedError, setReseedError] = useState<string | null>(null);
  const [reseedMessage, setReseedMessage] = useState<string | null>(null);

  // UI state
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Auto-populate bracket: seeds R1 from pool standings (or registration
  // seed when no pool phase exists). Gated server-side on pool completion.
  const [populating, setPopulating] = useState(false);
  const [populateMode, setPopulateMode] = useState<'overall' | 'top-n-per-pool'>('overall');
  const [populateTopN, setPopulateTopN] = useState<number | ''>('');
  const [populateMessage, setPopulateMessage] = useState<string | null>(null);
  // Confirm dialog state for the "no pool phase → registration seed
  // fallback" path. The BE happily seeds from registration order in
  // this case, but the operator might have expected pool standings to
  // drive the bracket; pop a confirm before submitting so they don't
  // mis-seed silently.
  const [showSeedFallbackConfirm, setShowSeedFallbackConfirm] = useState(false);
  const [showForceConfirm, setShowForceConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bracketRefreshKey, setBracketRefreshKey] = useState(0);

  const refreshBracket = useCallback(() => setBracketRefreshKey((k) => k + 1), []);

  // ── Load tournaments ────────────────────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const tournaments = (await res.json()) as Tournament[];
        setTournaments(tournaments);
        if (tournaments.length === 0) return;
        // Default to the first tournament only when the URL doesn't
        // already carry a valid tournamentId — preserves deep-links
        // and the shared-link experience.
        const urlTournamentId = searchParams.get('tournamentId') ?? '';
        const targetId = tournaments.some((t) => t.id === urlTournamentId)
          ? urlTournamentId
          : tournaments[0]!.id;
        setTimeout(() => setSelectedTournament(targetId), 0);
      })
      .catch(() => undefined);
    return () => controller.abort();
    // searchParams is captured at initial load only — subsequent URL
    // changes from this page (via the selector below) shouldn't refire
    // the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, apiUrl]);

  // Mirror the in-memory selection back to the URL so refresh + share
  // both land on the same tournament. router.replace keeps the page in
  // history without pushing a new entry per dropdown change. The
  // `#bracket` hash is preserved verbatim.
  useEffect(() => {
    if (!selectedTournament) return;
    if (typeof window === 'undefined') return;
    if (searchParams.get('tournamentId') === selectedTournament) return;
    const url = new URL(window.location.href);
    url.searchParams.set('tournamentId', selectedTournament);
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
  }, [selectedTournament, searchParams, router]);

  // ── Load tournament side colors ─────────────────────────────────────────────

  useEffect(() => {
    if (!selectedTournament) return;
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/tournaments/${selectedTournament}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as {
          weapon?: string | null;
          scoring_config?: { display?: { sideColors?: { red: string; blue: string } } };
        } | null;
        setTournamentWeapon(data?.weapon ?? null);
        const sc = data?.scoring_config?.display?.sideColors;
        if (sc) {
          setRedColor((sc.red as ColorToken) ?? 'red');
          setBlueColor((sc.blue as ColorToken) ?? 'blue');
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [selectedTournament, apiUrl]);

  // ── Clear tournament-scoped state on switch ─────────────────────────────────
  // Without this, the previous tournament's bracket / weapon / side
  // colors linger on screen when the operator switches to a tournament
  // that has no bracket yet (or while the new fetch is in flight). The
  // load effects below then populate from fresh data; a slow or empty
  // fetch correctly leaves the "Configure your bracket" state visible.
  // Kept as a SEPARATE effect (deps: [selectedTournament] only) so a
  // manual refresh / reseed via bracketRefreshKey doesn't flash the
  // bracket to empty before reloading.
  useEffect(() => {
    if (!selectedTournament) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset bracket-derived state when the selected tournament changes
    setBracket(null);
    setBracketPhaseId(null);
    setExistingBracket(false);
    setEditPodium(podiumFromBracket({}));
    setTournamentWeapon(null);
    setRedColor('red');
    setBlueColor('blue');
  }, [selectedTournament]);

  // ── Load existing bracket ───────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedTournament) return;
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/tournaments/${selectedTournament}/bracket`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as BracketResult | null;
        if (data && data.slots?.length > 0) {
          setBracket(data);
          setBracketPhaseId(data.phaseId);
          setExistingBracket(true);
          if (data.phaseType === 'double_elim') setPhaseType('double_elim');
          setEditPodium(podiumFromBracket(data));
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [selectedTournament, apiUrl, bracketRefreshKey]);

  // ── Load registrations for the override picker ─────────────────────────────
  // Refetched whenever the bracket itself refreshes (manual save, reseed,
  // realtime update) so a freshly-registered fighter appears in the picker
  // without a page reload.
  useEffect(() => {
    if (!selectedTournament) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale picker data when no tournament is selected
      setPickerRegistrations([]);
      return;
    }
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/tournaments/${selectedTournament}/registrations`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const raw = (await res.json()) as Array<{
          id: string;
          bib_number: number | null;
          seed: number | null;
          persons?: { given_name?: string | null; family_name?: string | null } | null;
          global_persons?: { display_name?: string | null } | null;
        }>;
        const mapped: PickerRegistration[] = raw.map((row) => {
          const composed = `${row.persons?.given_name ?? ''} ${
            row.persons?.family_name ?? ''
          }`.trim();
          const displayName =
            row.global_persons?.display_name?.trim() || composed || `Reg ${row.id.slice(0, 8)}`;
          return {
            id: row.id,
            displayName,
            bibNumber: row.bib_number,
            seed: row.seed,
          };
        });
        mapped.sort((a, b) => a.displayName.localeCompare(b.displayName));
        setPickerRegistrations(mapped);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [selectedTournament, apiUrl, bracketRefreshKey]);

  const filteredRegistrations = useMemo(() => {
    const q = pickerFilter.trim();
    if (!q) return pickerRegistrations;
    // fuzzyMatch = diacritic-insensitive, same behavior as standings/clubs
    // search ("gaelle" finds "Gaëlle").
    return pickerRegistrations.filter((r) => fuzzyMatch(q, r.displayName));
  }, [pickerRegistrations, pickerFilter]);

  // Event lices — for the per-fight lice pill + the edit-modal dropdown.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventId}/lices`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) setLices((await res.json()) as EventLice[]);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [eventId, apiUrl]);

  // Referee assignment board — supplies each match's role slots + candidates
  // for the edit modal. Refetched on bracketRefreshKey so a save (which calls
  // refreshBracket) re-reads the assignments.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventId}/referee-assignment-board`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) setRefereeBoard((await res.json()) as RefBoard);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [eventId, apiUrl, bracketRefreshKey]);

  // Event referee skills → id-to-name map, so role slots show the operator's
  // skill name instead of the raw skill id. Mirrors RefereesTab.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventId}/referee-skills`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) setRefereeSkills((await res.json()) as RefereeSkill[]);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [eventId, apiUrl]);

  const liceNameById = useMemo(() => new Map(lices.map((l) => [l.id, l.name])), [lices]);

  const skillNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of refereeSkills) if (s.name) map.set(s.id, s.name);
    return map;
  }, [refereeSkills]);

  // Resolve a referee role slot to a human label: operator-typed slot name >
  // DB skill name > i18n label for the three built-in roles > raw key.
  const roleLabel = (role: string): string => {
    const fromSkill = skillNameById.get(role);
    if (fromSkill) return fromSkill;
    const builtin = ['arbitre_declarant', 'arbitre_assesseur', 'arbitre_table'];
    return builtin.includes(role) ? t(`organizer.eventCompensation.roles.${role}`) : role;
  };

  // Role slots for the match being edited (from the board), for the modal.
  // Plain derived value — cheap, and the React Compiler handles memoization.
  const editMatchId = overrideModal?.matchId ?? null;
  const editMatchRoleSlots: RefBoardRoleSlot[] =
    editMatchId && refereeBoard
      ? (refereeBoard.pools.find((p) => p.matchIds?.includes(editMatchId))?.roleSlots ?? [])
      : [];

  // The slot open in the edit modal + whether it can be forfeited (both sides
  // resolved, not yet completed) — gates the modal's Forfeit section.
  const editSlot = overrideModal
    ? (bracket?.slots.find((s) => s.id === overrideModal.slotId) ?? null)
    : null;
  const canForfeit =
    !!overrideModal?.matchId &&
    !!editSlot?.redRegistrationId &&
    !!editSlot?.blueRegistrationId &&
    editSlot?.status !== 'completed';

  // ── Realtime: update individual match cards in place ───────────────────────

  useRealtimeWithFallback({
    channelName: bracketPhaseId ? `bracket-${bracketPhaseId}` : 'bracket-idle',
    table: 'matches',
    filter: bracketPhaseId
      ? `phase_id=eq.${bracketPhaseId}`
      : 'phase_id=eq.00000000-0000-0000-0000-000000000000',
    event: '*',
    onEvent: (payload) => {
      const incoming = payload.new as {
        id: string;
        bracket_slot_id?: string | null;
        red_score?: number | null;
        blue_score?: number | null;
        status?: string;
        red_registration_id?: string | null;
        blue_registration_id?: string | null;
      } | null;
      if (!incoming?.bracket_slot_id) {
        refreshBracket();
        return;
      }
      setBracket((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          slots: prev.slots.map((s) =>
            s.matchId === incoming.id || s.id === incoming.bracket_slot_id
              ? {
                  ...s,
                  matchId: incoming.id,
                  redScore: incoming.red_score ?? s.redScore,
                  blueScore: incoming.blue_score ?? s.blueScore,
                  status: incoming.status ?? s.status,
                }
              : s,
          ),
        };
      });
    },
    onFallbackPoll: refreshBracket,
    fallbackPollMs: 30_000,
  });

  // ── Generate bracket ────────────────────────────────────────────────────────

  async function generate(force = false) {
    if (!selectedTournament) return;
    setGenerating(true);
    setError(null);
    setShowForceConfirm(false);

    try {
      const body: Record<string, unknown> = { phaseType, seedingStrategy };
      if (qualifyCount !== '') body['qualifyCount'] = qualifyCount;
      if (bracketSize !== '') body['bracketSize'] = bracketSize;
      // Only the fields that apply in the chosen mode: the API REJECTS a
      // grand-final reset in bronze mode and a bronze match in gold mode
      // rather than ignoring them, so sending both would 400.
      if (phaseType === 'double_elim') Object.assign(body, podiumPayload(newPodium));

      const res = await fetch(
        `${apiUrl}/api/v1/tournaments/${selectedTournament}/generate-bracket${force ? '?force=true' : ''}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        },
      );

      if (res.status === 409) {
        setShowForceConfirm(true);
        return;
      }

      if (!res.ok) {
        const errBody = (await res.json()) as { message?: string };
        throw new Error(errBody.message ?? t('admin.common.generationFailed'));
      }

      const result = (await res.json()) as BracketResult;
      setBracket(result);
      setBracketPhaseId(result.phaseId);
      setExistingBracket(true);
      setEditPodium(podiumFromBracket(result));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.common.generationFailed'));
    } finally {
      setGenerating(false);
    }
  }

  async function populateBracket() {
    if (!selectedTournament || populating) return;
    setPopulating(true);
    setError(null);
    setPopulateMessage(null);
    try {
      const body: Record<string, unknown> = { seedingMode: populateMode };
      if (populateMode === 'top-n-per-pool' && populateTopN !== '') {
        body['topNPerPool'] = populateTopN;
      }
      const res = await fetch(
        `${apiUrl}/api/v1/tournaments/${selectedTournament}/populate-bracket`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as { message?: string } | null;
        // On 409, prefer the BE's actual message — the API now emits
        // two distinct refusals ("Pools have not finished yet" vs
        // "No pool data available — generate pools and play matches
        // first.") and the operator needs to know which one fired.
        // Fall back to the canned i18n string only when the BE didn't
        // attach a message.
        const msg =
          res.status === 409
            ? (errBody?.message ?? t('organizer.bracket.autoPopulatePoolsNotFinished'))
            : (errBody?.message ?? t('admin.common.populateFailed'));
        throw new Error(msg);
      }
      // `source` names the ORDERING the BE actually applied, not just the
      // table the fighters came from — a shuffled draw must not be reported
      // as "from pool standings".
      const result = (await res.json().catch(() => ({}))) as {
        source?: 'pool-standings' | 'registration-seed' | 'rating' | 'random';
      };
      const successKey =
        result.source === 'registration-seed'
          ? 'organizer.bracket.autoPopulateSuccessFromSeed'
          : result.source === 'rating'
            ? 'organizer.bracket.autoPopulateSuccessFromRating'
            : result.source === 'random'
              ? 'organizer.bracket.autoPopulateSuccessFromRandom'
              : 'organizer.bracket.autoPopulateSuccess';
      setPopulateMessage(t(successKey));
      refreshBracket();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.common.populateFailed'));
    } finally {
      setPopulating(false);
    }
  }

  async function deleteBracket() {
    if (!bracketPhaseId || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/phases/${bracketPhaseId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok && res.status !== 204) {
        const errBody = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(errBody?.message ?? t('admin.common.deleteFailed'));
      }
      // Drop client state and fall back to the empty state.
      setBracket(null);
      setBracketPhaseId(null);
      setExistingBracket(false);
      setShowDeleteConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.common.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  }

  // Phase visibility is no longer an operator toggle — tournament status
  // is the canonical public gate. The "Notify participants" link is
  // surfaced once a bracket exists; operators don't publish a phase
  // separately to send a notification.
  const notifyHref = useMemo(() => {
    if (!bracketPhaseId || !selectedTournament) return null;
    const query = new URLSearchParams({
      targetType: 'fighters_and_referees',
      severity: 'info',
      tournamentId: selectedTournament,
      title: t('organizer.phaseVisibility.bracketReadyTitle'),
      body: t('organizer.phaseVisibility.bracketReadyBody'),
    });
    return `/org/${slug}/events/${eventId}/notifications?${query.toString()}`;
  }, [bracketPhaseId, selectedTournament, t, slug, eventId]);

  // Open the edit modal for a slot, seeding the lice from the slot's current
  // match placement so the dropdown shows where it's assigned.
  function openOverride(slotId: string) {
    const slot = bracket?.slots.find((s) => s.id === slotId);
    setOverrideModal({
      slotId,
      matchId: slot?.matchId ?? null,
      regAId: undefined,
      regBId: undefined,
      liceId: slot?.liceId ?? null,
      roleChanges: {},
    });
    setOverrideError(null);
    resetForfeitDraft();
  }

  async function submitOverride() {
    if (!overrideModal) return;
    setOverriding(true);
    setOverrideError(null);
    try {
      // 1. Fighters (bracket slot) — only when the operator touched a side.
      if (overrideModal.regAId !== undefined || overrideModal.regBId !== undefined) {
        const body: Record<string, string | null> = {};
        if (overrideModal.regAId !== undefined) body['registrationAId'] = overrideModal.regAId;
        if (overrideModal.regBId !== undefined) body['registrationBId'] = overrideModal.regBId;
        const res = await fetch(`${apiUrl}/api/v1/bracket-slots/${overrideModal.slotId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errBody = (await res.json()) as { message?: string };
          throw new Error(errBody.message ?? t('admin.common.overrideFailed'));
        }
      }

      const matchId = overrideModal.matchId;
      if (matchId) {
        // 2. Lice — PATCH /matches/:id (preserves scheduled_at) when changed.
        const slot = bracket?.slots.find((s) => s.id === overrideModal.slotId);
        const currentLiceId = slot?.liceId ?? null;
        if (overrideModal.liceId !== currentLiceId) {
          const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ liceId: overrideModal.liceId }),
          });
          if (!res.ok) {
            const errBody = (await res.json()) as { message?: string };
            throw new Error(errBody.message ?? t('admin.common.liceUpdateFailed'));
          }
        }

        // 3. Referees — diff the board's current assignments vs the draft and
        //    PUT only the changed (role, refereeId) pairs.
        const roleSlots =
          refereeBoard?.pools.find((p) => p.matchIds?.includes(matchId))?.roleSlots ?? [];
        const current = roleSlots.map((rs) => ({
          role: rs.role,
          refereeId: rs.assignment?.personId ?? null,
        }));
        const draft = current.map((c) => ({
          role: c.role,
          refereeId: Object.prototype.hasOwnProperty.call(overrideModal.roleChanges, c.role)
            ? (overrideModal.roleChanges[c.role] ?? null)
            : c.refereeId,
        }));
        for (const change of diffRoleAssignments(current, draft)) {
          const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}/referee-role-assignments`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ role: change.role, refereeId: change.refereeId }),
          });
          if (!res.ok) {
            const errBody = (await res.json()) as { message?: string };
            throw new Error(errBody.message ?? t('admin.common.refereeUpdateFailed'));
          }
        }
      }

      setOverrideModal(null);
      setPickerFilter('');
      refreshBracket();
    } catch (err) {
      setOverrideError(err instanceof Error ? err.message : t('admin.common.overrideFailed'));
    } finally {
      setOverriding(false);
    }
  }

  async function saveBracketConfig() {
    if (!bracketPhaseId || configSaving) return;
    setConfigSaving(true);
    setConfigError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/phases/${bracketPhaseId}/bracket-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        // Only `grandFinalReset` is editable in place — the podium model and
        // the cutoff reshape the losers bracket, so the API refuses them here
        // and the form locks them.
        body: JSON.stringify({ grandFinalReset: editPodium.grandFinalReset }),
      });
      if (res.status === 409) {
        setConfigError(t('organizer.phaseVisibility.configLocked'));
        return;
      }
      if (!res.ok) {
        const errBody = (await res.json()) as { message?: string };
        throw new Error(errBody.message ?? t('admin.common.couldNotSaveConfig'));
      }
      refreshBracket();
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : t('admin.common.couldNotSaveConfig'));
    } finally {
      setConfigSaving(false);
    }
  }

  async function submitReseed() {
    if (!bracketPhaseId || reseedRunning) return;
    setReseedRunning(true);
    setReseedError(null);
    setReseedMessage(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/phases/${bracketPhaseId}/reseed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ strategy: reseedStrategy }),
      });
      if (res.status === 409) {
        setReseedError(t('organizer.phaseVisibility.reseedBlocked'));
        return;
      }
      if (res.status === 501) {
        const errBody = (await res.json()) as { message?: string };
        setReseedError(errBody.message ?? t('admin.common.strategyNotImplemented'));
        return;
      }
      if (!res.ok) {
        const errBody = (await res.json()) as { message?: string };
        throw new Error(errBody.message ?? t('admin.common.reseedFailed'));
      }
      setReseedMessage(t('organizer.phaseVisibility.reseedSuccess'));
      setReseedOpen(false);
      refreshBracket();
    } catch (err) {
      setReseedError(err instanceof Error ? err.message : t('admin.common.reseedFailed'));
    } finally {
      setReseedRunning(false);
    }
  }

  const bracketConfig: BracketConfig | undefined = bracket
    ? {
        phaseType: (bracket.phaseType as 'single_elim' | 'double_elim') ?? 'single_elim',
        rounds: bracket.rounds,
        wbRounds: bracket.wbRounds ?? undefined,
        lbRounds: bracket.lbRounds ?? undefined,
      }
    : undefined;

  // Identify the bronze slot and derive the medal podium from the bracket.
  const { bronzeMatch, podium } = useMemo(() => {
    if (!bracket) {
      return {
        bronzeMatch: null as BracketSlotData | null,
        podium: undefined as PodiumData | undefined,
      };
    }
    if (bracket.phaseType === 'double_elim') {
      return {
        bronzeMatch: null as BracketSlotData | null,
        podium: deriveDoubleElimPodium(bracket, { winnerName, loserName }),
      };
    }
    const bronze = bracket.bronzeSlotId
      ? (bracket.slots.find((s) => s.id === bracket.bronzeSlotId) ?? null)
      : null;
    if (!bronze) {
      return { bronzeMatch: null, podium: undefined };
    }
    const mainSlots = bracket.slots.filter((s) => s.id !== bronze.id);
    const maxRound = mainSlots.reduce((m, s) => Math.max(m, s.round), 0);
    const final = mainSlots.find((s) => s.round === maxRound) ?? null;
    const goldFighter = final && final.status === 'completed' ? winnerName(final) : null;
    const silverFighter = final && final.status === 'completed' ? loserName(final) : null;
    const bronzeFighter = bronze.status === 'completed' ? winnerName(bronze) : null;
    const fourthFighter = bronze.status === 'completed' ? loserName(bronze) : null;
    return {
      bronzeMatch: bronze,
      podium: {
        gold: goldFighter,
        silver: silverFighter,
        bronze: bronzeFighter,
        fourth: fourthFighter,
      },
    };
  }, [bracket]);

  // Disable Re-seed if any R1 match has started (best-effort client-side hint).
  const r1HasStartedMatch = useMemo(() => {
    if (!bracket) return false;
    return bracket.slots.some((s) => s.round === 1 && s.status !== 'scheduled' && s.status !== '');
  }, [bracket]);

  return (
    <main className="mx-auto max-w-[110rem] px-4 py-6">
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
              {t('organizer.bracketPage.breadcrumbEvent')}
            </Link>
            <span>/</span>
            <span className="text-foreground font-medium">
              {t('organizer.bracketPage.breadcrumbBracket')}
            </span>
          </div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl">
            {t('organizer.bracketPage.title')}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/org/${slug}/events/${eventId}/ai-assistant?type=bracket_plan${selectedTournament ? `&tournamentId=${selectedTournament}` : ''}`}
            className="border border-border hover:border-border text-foreground-secondary font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            {t('organizer.aiAssistant.suggest')}
          </Link>
          <Link
            href={`/org/${slug}/events/${eventId}/pools`}
            className="border border-border hover:border-border text-foreground-secondary font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            {t('organizer.bracketPage.backToPools')}
          </Link>
        </div>
      </div>

      {/* R5: tab nav */}
      <nav
        aria-label={t('organizer.bracketPage.sectionsAria')}
        className="mb-6 flex gap-1 border-b border-border"
      >
        {BRACKET_TABS.map((tab) => {
          const disabled = tab.key === 'referees' && !selectedTournament;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => !disabled && selectTab(tab.key)}
              disabled={disabled}
              title={disabled ? t('organizer.bracketPage.tabs.disabledHint') : undefined}
              className={[
                'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                activeTab === tab.key
                  ? 'border-accent text-accent'
                  : disabled
                    ? 'border-transparent text-muted cursor-not-allowed'
                    : 'border-transparent text-foreground-secondary hover:text-foreground',
              ].join(' ')}
            >
              {t(tab.labelKey)}
            </button>
          );
        })}
      </nav>

      {/* R5: Referees tab — bracket + finals assignment + timeline. */}
      {activeTab === 'referees' && selectedTournament && (
        <BracketRefereesTab
          eventId={eventId}
          tournamentId={selectedTournament}
          isReadOnly={isReadOnly}
        />
      )}

      {/* Bracket tab — the existing flat content lives below the
          display-toggle wrapper. Wrapping with style=display:none keeps
          state + effects alive when switching tabs (so the Referees tab
          doesn't refetch on every toggle), at the cost of rendering both
          DOM trees in memory. The bracket tree is sizable but well-
          tolerated by the browser; the alternative (conditional render
          + state reset on every switch) was worse UX. */}
      <div style={{ display: activeTab === 'bracket' ? 'block' : 'none' }}>
        {bracketPhaseId && (
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4">
            {notifyHref && (
              <Link href={notifyHref} className="text-sm font-semibold text-accent underline">
                {t('organizer.phaseVisibility.notifyParticipants')}
              </Link>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setReseedOpen(true)}
                disabled={r1HasStartedMatch}
                title={r1HasStartedMatch ? t('organizer.phaseVisibility.reseedBlocked') : undefined}
                className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground-secondary disabled:opacity-40"
              >
                {t('organizer.phaseVisibility.reseedButton')}
              </button>
            </div>
            {bracket?.autoAdvance === false && (
              <span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
                {t('organizer.bracketPage.manualMode')}
              </span>
            )}
          </div>
        )}

        {/* Tournament selector — one tab per tournament. Active tab
            highlights with the same red border treatment as the
            Bracket/Referees tab strip above. `flex-wrap` lets many
            tournaments wrap to multiple rows; the color dot mirrors
            the schedule grid for at-a-glance recognition. */}
        {tournaments.length > 1 && (
          <nav
            aria-label={t('organizer.bracketPage.tournamentTabsLabel')}
            className="mb-4 flex flex-wrap gap-1 border-b border-border"
          >
            {tournaments.map((tour) => {
              const active = tour.id === selectedTournament;
              return (
                <button
                  key={tour.id}
                  type="button"
                  onClick={() => setSelectedTournament(tour.id)}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'border-accent text-accent'
                      : 'border-transparent text-foreground-secondary hover:text-foreground',
                  ].join(' ')}
                >
                  <TournamentColorDot color={tour.color} size="sm" />
                  <span>{tour.name}</span>
                </button>
              );
            })}
          </nav>
        )}

        {/* Generate config */}
        {!existingBracket && (
          <div className="bg-background border border-border rounded-xl p-5 mb-6">
            <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground-secondary mb-4">
              {t('organizer.bracketPage.configTitle')}
            </h2>
            <div className="flex flex-wrap gap-6 items-end">
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">
                  {t('organizer.bracketPage.formatLabel')}
                </label>
                <select
                  value={phaseType}
                  onChange={(e) => setPhaseType(e.target.value as 'single_elim' | 'double_elim')}
                  className="border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 ring-accent"
                >
                  <option value="single_elim">{t('organizer.bracketPage.formatSingle')}</option>
                  <option value="double_elim">{t('organizer.bracketPage.formatDouble')}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">
                  {t('organizer.bracketPage.qualifyCountLabel')}
                </label>
                <input
                  type="number"
                  value={qualifyCount}
                  onChange={(e) =>
                    setQualifyCount(e.target.value === '' ? '' : parseInt(e.target.value))
                  }
                  placeholder={t('organizer.bracketPage.autoPlaceholder')}
                  min="2"
                  className="w-24 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 ring-accent"
                />
                <p className="mt-1 max-w-xs text-xs text-muted">
                  {phaseType === 'single_elim'
                    ? t('organizer.bracketPage.qualifyHintSingle', { max: MAX_BRACKET_SIZE })
                    : t('organizer.bracketPage.qualifyHintDouble', { max: MAX_BRACKET_SIZE })}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">
                  {t('organizer.bracketPage.sizeOverrideLabel', { max: MAX_BRACKET_SIZE })}
                </label>
                <select
                  value={bracketSize}
                  onChange={(e) => {
                    const next = e.target.value === '' ? '' : parseInt(e.target.value);
                    setBracketSize(next);
                    // Auto bracket size ⇒ Auto qualify count, so generate()
                    // omits both and the server auto-sizes from entrants.
                    if (next === '') setQualifyCount('');
                  }}
                  className="border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 ring-accent"
                >
                  <option value="">{t('organizer.bracketPage.autoOption')}</option>
                  {BRACKET_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 flex items-center text-xs font-medium text-foreground-secondary">
                  {t('organizer.phaseVisibility.seedingStrategyLabel')}
                  <HelpTooltip text={rulesetHelp('seedingStrategy', t)} />
                </label>
                <select
                  value={seedingStrategy}
                  onChange={(e) => setSeedingStrategy(e.target.value as SeedingStrategy)}
                  className="border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 ring-accent"
                >
                  {SEEDING_STRATEGIES.map((s) => (
                    <option key={s} value={s}>
                      {t(`organizer.phaseVisibility.seedingStrategy${strategyKey(s)}`)}
                    </option>
                  ))}
                </select>
              </div>
              {phaseType === 'double_elim' && (
                <>
                  <DoubleElimPodiumOptions value={newPodium} onChange={setNewPodium} t={t} />
                  {/* A field that isn't a power of two is trimmed by a play-in
                      round. Its losers are OUT after one loss, which surprises
                      organisers who expect double elim to mean two lives for
                      everyone, so say it before they generate. */}
                  <p className="text-xs text-muted">
                    {t('organizer.bracketPage.playInQualifierNote')}
                  </p>
                </>
              )}
              <button
                onClick={() => void generate(false)}
                disabled={generating || !selectedTournament}
                className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
              >
                {generating
                  ? t('organizer.bracketPage.generating')
                  : t('organizer.bracketPage.generateButton')}
              </button>
            </div>
          </div>
        )}

        {/* Configuration card (post-generation edit) */}
        {existingBracket && bracket && (
          <div className="mb-6 rounded-xl border border-border bg-surface p-5">
            <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground-secondary mb-4">
              {t('organizer.phaseVisibility.configCardTitle')}
            </h2>
            <div className="flex flex-wrap items-end gap-6 text-sm">
              <div>
                <p className="text-xs text-muted">
                  {t('organizer.phaseVisibility.configBracketSize')}
                </p>
                <p className="font-mono text-foreground">{bracket.bracketSize}</p>
              </div>
              <div>
                <p className="text-xs text-muted">
                  {t('organizer.phaseVisibility.configFighterCount')}
                </p>
                <p className="font-mono text-foreground">{bracket.fighterCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted">
                  {t('organizer.phaseVisibility.configPhaseType')}
                </p>
                <p className="font-mono text-foreground">{bracket.phaseType}</p>
              </div>
              {bracket.phaseType === 'double_elim' && (
                <button
                  onClick={() => void saveBracketConfig()}
                  disabled={configSaving}
                  className="rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-50 px-3 py-2 text-sm font-semibold text-accent-foreground"
                >
                  {configSaving
                    ? t('organizer.phaseVisibility.configSaving')
                    : t('organizer.phaseVisibility.configSave')}
                </button>
              )}
              <button
                onClick={() => setShowForceConfirm(true)}
                disabled={generating || deleting}
                className="ml-auto rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground-secondary disabled:opacity-50"
              >
                {t('organizer.bracketPage.regenerateButton')}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={generating || deleting}
                className="rounded-lg border border-danger/30 bg-surface hover:bg-danger/10 px-3 py-2 text-sm font-semibold text-danger disabled:opacity-50"
              >
                {t('organizer.bracketPage.deleteButton')}
              </button>
            </div>

            {/* Auto-populate row: pick mode (overall / top-N per pool),
                optional N, click to fan pool standings into R1. Server
                gates on pool completion + R1-not-started; we mirror the
                pool-completion gate client-side so the warning surfaces
                before the click. */}
            <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 text-sm">
              {bracket.poolsCompleted === false && (
                <p className="text-xs font-medium text-warning">
                  ⚠ {t('organizer.bracket.autoPopulatePoolsNotFinished')}
                </p>
              )}
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted">
                    {t('organizer.bracket.autoPopulateButton')}
                  </span>
                  <select
                    value={populateMode}
                    onChange={(e) =>
                      setPopulateMode(e.target.value as 'overall' | 'top-n-per-pool')
                    }
                    disabled={populating}
                    className="rounded-md border border-border px-2 py-1.5 text-sm"
                  >
                    <option value="overall">
                      {t('organizer.bracket.autoPopulateModeOverall')}
                    </option>
                    <option value="top-n-per-pool">
                      {t('organizer.bracket.autoPopulateModeTopNPerPool')}
                    </option>
                  </select>
                </label>
                {populateMode === 'top-n-per-pool' && (
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-muted">
                      {t('organizer.bracket.autoPopulateTopNLabel')}
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={populateTopN}
                      onChange={(e) =>
                        setPopulateTopN(e.target.value === '' ? '' : Number(e.target.value))
                      }
                      disabled={populating}
                      className="w-20 rounded-md border border-border px-2 py-1.5 text-sm"
                    />
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => {
                    // Straight-to-bracket tournaments (no pool phase)
                    // will fall through to the registration-seed
                    // branch server-side. Show a confirm dialog first
                    // so the operator doesn't mis-seed without knowing
                    // that's what's about to happen.
                    if (bracket.hasPoolPhase === false) {
                      setShowSeedFallbackConfirm(true);
                      return;
                    }
                    void populateBracket();
                  }}
                  disabled={populating || !existingBracket || bracket.poolsCompleted === false}
                  title={
                    bracket.poolsCompleted === false
                      ? t('organizer.bracket.autoPopulatePoolsNotFinished')
                      : undefined
                  }
                  className="rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-50 px-3 py-2 text-sm font-semibold text-accent-foreground"
                >
                  {populating ? '…' : t('organizer.bracket.autoPopulateButton')}
                </button>
                {populateMessage && <span className="text-xs text-success">{populateMessage}</span>}
              </div>
            </div>
            {bracket.phaseType === 'double_elim' && (
              <>
                {/* Same controls as the generate form, so the podium model an
                    existing bracket was built with stays visible. Everything
                    but the grand-final reset is locked: those options decide
                    which slots exist. */}
                <DoubleElimPodiumOptions
                  value={editPodium}
                  onChange={setEditPodium}
                  t={t}
                  structuralLocked
                />
                <p className="mt-3 text-xs text-muted">
                  {t('organizer.phaseVisibility.configGrandFinalResetHint')}
                </p>
              </>
            )}
            {configError && <p className="mt-2 text-sm text-danger">{configError}</p>}
            {reseedMessage && <p className="mt-2 text-sm text-success">{reseedMessage}</p>}
          </div>
        )}

        {error && (
          <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 mb-4 text-sm">
            {error}
          </div>
        )}

        {/* Auto-populate "no pool phase → registration seed" confirm */}
        <Modal
          open={showSeedFallbackConfirm}
          onClose={() => setShowSeedFallbackConfirm(false)}
          size="sm"
          title={t('organizer.bracket.autoPopulateNoPoolsTitle')}
          footer={
            <>
              <button
                type="button"
                onClick={() => setShowSeedFallbackConfirm(false)}
                className="px-4 py-2 border border-border rounded-lg text-sm text-foreground-secondary hover:bg-background"
              >
                {t('organizer.bracket.autoPopulateNoPoolsCancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSeedFallbackConfirm(false);
                  void populateBracket();
                }}
                className="px-4 py-2 bg-accent hover:bg-accent-hover text-accent-foreground font-semibold rounded-lg text-sm"
              >
                {t('organizer.bracket.autoPopulateNoPoolsConfirm')}
              </button>
            </>
          }
        >
          <p className="text-4xl mb-3">⚠️</p>
          <p className="text-foreground-secondary text-sm mb-5">
            {t('organizer.bracket.autoPopulateNoPoolsBody')}
          </p>
        </Modal>

        {/* Force confirm modal */}
        <Modal
          open={showForceConfirm}
          onClose={() => setShowForceConfirm(false)}
          size="sm"
          title={t('organizer.bracketPage.regenerateConfirmTitle')}
          footer={
            <>
              <button
                onClick={() => setShowForceConfirm(false)}
                className="px-4 py-2 border border-border rounded-lg text-sm text-foreground-secondary hover:bg-background"
              >
                {t('organizer.bracketPage.cancel')}
              </button>
              <button
                onClick={() => void generate(true)}
                className="px-4 py-2 bg-danger hover:bg-danger-hover text-danger-foreground font-semibold rounded-lg text-sm"
              >
                {t('organizer.bracketPage.regenerateConfirmYes')}
              </button>
            </>
          }
        >
          <p className="text-4xl mb-3">⚠️</p>
          <p className="text-muted text-sm mb-5">
            {t('organizer.bracketPage.regenerateConfirmBody')}
          </p>
        </Modal>

        {/* Delete confirm modal — distinct from regenerate: leaves no bracket behind. */}
        {bracket && (
          <Modal
            open={showDeleteConfirm}
            onClose={() => setShowDeleteConfirm(false)}
            busy={deleting}
            size="sm"
            title={t('organizer.bracketPage.deleteConfirmTitle')}
            footer={
              <>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                  className="flex-1 px-4 py-2 border border-border rounded-lg text-sm text-foreground-secondary hover:bg-background disabled:opacity-50"
                >
                  {t('organizer.bracketPage.cancel')}
                </button>
                <button
                  onClick={() => void deleteBracket()}
                  disabled={deleting}
                  className="flex-1 px-4 py-2 bg-danger hover:bg-danger-hover text-danger-foreground font-semibold rounded-lg text-sm disabled:opacity-50"
                >
                  {deleting
                    ? t('organizer.bracketPage.deleting')
                    : t('organizer.bracketPage.deleteButton')}
                </button>
              </>
            }
          >
            <p className="text-4xl mb-3 text-center">🗑️</p>
            <p className="text-foreground-secondary text-sm mb-4 text-center">
              {t('organizer.bracketPage.deleteConfirmBody')}
            </p>
            <ul className="text-sm text-foreground-secondary mb-5 space-y-1 mx-auto max-w-[240px]">
              <li className="flex justify-between">
                <span>{t('organizer.bracketPage.deleteRowSlots')}</span>
                <span className="font-mono text-foreground">{bracket.slots?.length ?? 0}</span>
              </li>
              <li className="flex justify-between">
                <span>{t('organizer.bracketPage.deleteRowMatches')}</span>
                <span className="font-mono text-foreground">{bracket.slots?.length ?? 0}</span>
              </li>
              <li className="flex justify-between text-muted">
                <span>{t('organizer.bracketPage.deleteRowReferees')}</span>
                <span className="font-mono">{t('organizer.bracketPage.deleteRowCascaded')}</span>
              </li>
            </ul>
            <p className="text-xs text-muted mb-5 text-center">
              {t('organizer.bracketPage.deleteConfirmHint')}
            </p>
          </Modal>
        )}

        {/* Override modal — searchable registration picker. Two panes,
            one per side (A = red, B = blue). Each pane shows the same
            filtered list; clicking a row sets that side to the
            registration id; "Clear" sends an explicit null so the
            backend wipes the assignment. */}
        {overrideModal && (
          <Modal
            open
            onClose={() => {
              setOverrideModal(null);
              setPickerFilter('');
              resetForfeitDraft();
            }}
            busy={overriding}
            size="lg"
            title={t('organizer.bracket.overrideModal.title')}
            footer={
              <>
                <button
                  onClick={() => {
                    setOverrideModal(null);
                    setPickerFilter('');
                    resetForfeitDraft();
                  }}
                  className="flex-1 px-4 py-2 border border-border rounded-lg text-sm text-foreground-secondary hover:bg-background"
                >
                  {t('organizer.bracketPage.cancel')}
                </button>
                <button
                  onClick={() => void submitOverride()}
                  disabled={overriding}
                  className="flex-1 px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold rounded-lg text-sm"
                >
                  {overriding ? t('organizer.bracketPage.saving') : t('organizer.bracketPage.save')}
                </button>
              </>
            }
          >
            <input
              type="text"
              value={pickerFilter}
              onChange={(e) => setPickerFilter(e.target.value)}
              placeholder={t('organizer.bracket.overrideModal.filterPlaceholder')}
              className="w-full border border-border rounded-lg px-3 py-1.5 text-sm mb-3 focus:outline-none focus:ring-2 ring-accent"
            />
            <div className="grid grid-cols-2 gap-3 mb-4">
              {(['A', 'B'] as const).map((side) => {
                const currentId = side === 'A' ? overrideModal.regAId : overrideModal.regBId;
                const sideLabel =
                  side === 'A'
                    ? t('organizer.bracket.overrideModal.sideA')
                    : t('organizer.bracket.overrideModal.sideB');
                const setSide = (value: string | null) =>
                  setOverrideModal({
                    ...overrideModal,
                    ...(side === 'A' ? { regAId: value } : { regBId: value }),
                  });
                return (
                  <div
                    key={side}
                    className="flex flex-col rounded-lg border border-border bg-background"
                  >
                    <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                      {sideLabel}
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {filteredRegistrations.length === 0 ? (
                        <p className="px-3 py-3 text-xs italic text-muted">
                          {t('organizer.bracket.overrideModal.empty')}
                        </p>
                      ) : (
                        filteredRegistrations.map((reg) => {
                          const active = currentId === reg.id;
                          return (
                            <button
                              key={reg.id}
                              type="button"
                              onClick={() => setSide(reg.id)}
                              className={[
                                'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors border-b border-border last:border-b-0',
                                active
                                  ? 'bg-accent/10 text-accent font-semibold'
                                  : 'text-foreground-secondary hover:bg-surface',
                              ].join(' ')}
                            >
                              <span className="truncate">{reg.displayName}</span>
                              {reg.bibNumber !== null && (
                                <span className="shrink-0 rounded bg-border px-1 py-px text-[10px] text-foreground-secondary">
                                  #{reg.bibNumber}
                                </span>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSide(null)}
                      className={[
                        'border-t border-border px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-surface',
                        currentId === null ? 'bg-accent/10 text-accent' : '',
                      ].join(' ')}
                    >
                      {t('organizer.bracket.overrideModal.clear')}
                    </button>
                  </div>
                );
              })}
            </div>
            {overrideModal.matchId && (
              <div className="mb-4 space-y-2 border-t border-border pt-3">
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-foreground-secondary">
                    {t('organizer.bracket.overrideModal.liceLabel')}
                  </span>
                  <select
                    value={overrideModal.liceId ?? ''}
                    onChange={(e) =>
                      setOverrideModal({ ...overrideModal, liceId: e.target.value || null })
                    }
                    className="rounded-md border border-border px-2 py-1 text-sm"
                  >
                    <option value="">{t('organizer.bracket.overrideModal.liceNone')}</option>
                    {lices.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                {editMatchRoleSlots.map((rs) => {
                  const current = rs.assignment?.personId ?? null;
                  const value = Object.prototype.hasOwnProperty.call(
                    overrideModal.roleChanges,
                    rs.role,
                  )
                    ? (overrideModal.roleChanges[rs.role] ?? '')
                    : (current ?? '');
                  const options = [...rs.candidates.recommended, ...rs.candidates.warning];
                  const currentMissing =
                    current !== null && !options.some((c) => c.personId === current);
                  return (
                    <label
                      key={rs.role}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="font-semibold text-foreground-secondary">
                        {rs.displayName ?? roleLabel(rs.role)}
                      </span>
                      <select
                        value={value}
                        onChange={(e) =>
                          setOverrideModal({
                            ...overrideModal,
                            roleChanges: {
                              ...overrideModal.roleChanges,
                              [rs.role]: e.target.value || null,
                            },
                          })
                        }
                        className="rounded-md border border-border px-2 py-1 text-sm"
                      >
                        <option value="">{t('organizer.bracket.overrideModal.refereeNone')}</option>
                        {currentMissing && rs.assignment && (
                          <option value={current ?? ''}>{rs.assignment.displayName}</option>
                        )}
                        {options.map((c) =>
                          c.personId ? (
                            <option key={c.personId} value={c.personId}>
                              {c.displayName}
                            </option>
                          ) : null,
                        )}
                      </select>
                    </label>
                  );
                })}
              </div>
            )}
            {canForfeit && editSlot && (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-danger">
                  {t('organizer.bracketPage.forfeitTitle')}
                </p>
                <div className="mb-2 space-y-1.5">
                  {(['red', 'blue'] as const).map((side) => {
                    const name =
                      side === 'red' ? editSlot.redFighterName : editSlot.blueFighterName;
                    const active = forfeitSide === side;
                    return (
                      <button
                        key={side}
                        type="button"
                        onClick={() => setForfeitSide(side)}
                        className={[
                          'w-full rounded-md border px-3 py-1.5 text-left text-sm transition-colors',
                          active
                            ? 'border-danger bg-surface text-danger'
                            : 'border-border bg-surface hover:border-border',
                        ].join(' ')}
                      >
                        <span className="font-semibold">
                          {side === 'red'
                            ? t('organizer.bracketPage.forfeitRed')
                            : t('organizer.bracketPage.forfeitBlue')}
                        </span>
                        <span className="ml-2 text-foreground-secondary">— {name ?? '?'}</span>
                      </button>
                    );
                  })}
                </div>
                <select
                  value={forfeitReason}
                  onChange={(e) => setForfeitReason(e.target.value as ForfeitReason)}
                  className="mb-2 w-full rounded-md border border-border px-2 py-1 text-sm"
                >
                  <option value="voluntary">
                    {t('organizer.bracketPage.forfeitReasonVoluntary')}
                  </option>
                  <option value="injury">{t('organizer.bracketPage.forfeitReasonInjury')}</option>
                  <option value="black_card_1">
                    {t('organizer.bracketPage.forfeitReasonBlackCard1')}
                  </option>
                  <option value="black_card_2">
                    {t('organizer.bracketPage.forfeitReasonBlackCard2')}
                  </option>
                  <option value="conduct_violation">
                    {t('organizer.bracketPage.forfeitReasonConduct')}
                  </option>
                </select>
                {forfeitError && <p className="mb-2 text-xs text-danger">{forfeitError}</p>}
                <button
                  type="button"
                  onClick={() => void submitForfeit()}
                  disabled={forfeitBusy || !forfeitSide}
                  className="w-full rounded-md bg-danger px-3 py-1.5 text-sm font-semibold text-danger-foreground hover:bg-danger-hover disabled:opacity-50"
                >
                  {forfeitBusy ? '…' : t('organizer.bracketPage.forfeitTitle')}
                </button>
              </div>
            )}
            {overrideError && <p className="text-danger text-sm mb-3">{overrideError}</p>}
          </Modal>
        )}

        {/* Re-seed modal */}
        <Modal
          open={reseedOpen}
          onClose={() => {
            setReseedOpen(false);
            setReseedError(null);
          }}
          busy={reseedRunning}
          size="md"
          title={t('organizer.phaseVisibility.reseedTitle')}
          description={t('organizer.phaseVisibility.reseedHint')}
          footer={
            <>
              <button
                onClick={() => {
                  setReseedOpen(false);
                  setReseedError(null);
                }}
                className="flex-1 px-4 py-2 border border-border rounded-lg text-sm text-foreground-secondary hover:bg-background"
              >
                {t('organizer.bracketPage.cancel')}
              </button>
              <button
                onClick={() => void submitReseed()}
                disabled={reseedRunning || r1HasStartedMatch}
                className="flex-1 px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold rounded-lg text-sm"
              >
                {reseedRunning
                  ? t('organizer.phaseVisibility.reseedApplying')
                  : t('organizer.phaseVisibility.reseedApply')}
              </button>
            </>
          }
        >
          <label className="mb-1 flex items-center text-xs font-medium text-foreground-secondary">
            {t('organizer.phaseVisibility.reseedStrategyLabel')}
            <HelpTooltip text={rulesetHelp('seedingStrategy', t)} />
          </label>
          <select
            value={reseedStrategy}
            onChange={(e) => setReseedStrategy(e.target.value as SeedingStrategy)}
            className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 ring-accent mb-4"
          >
            {SEEDING_STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {t(`organizer.phaseVisibility.seedingStrategy${strategyKey(s)}`)}
              </option>
            ))}
          </select>
          {reseedError && <p className="text-danger text-sm mb-3">{reseedError}</p>}
        </Modal>

        {/* Bracket preview */}
        {bracket && (
          <div>
            <div className="flex flex-wrap items-center gap-4 mb-4 text-sm text-muted">
              <span>{t('organizer.bracketPage.summarySlots', { count: bracket.bracketSize })}</span>
              <span>·</span>
              <span>{t('organizer.bracketPage.summaryRounds', { count: bracket.rounds })}</span>
              <span>·</span>
              <span>{t('organizer.bracketPage.summaryByes', { count: bracket.byeCount })}</span>
              {bracket.hasPlayInRound && (
                <>
                  <span>·</span>
                  <span>
                    {t('organizer.phaseVisibility.bracketSummaryPlayIns', {
                      count: bracket.playInMatchCount ?? 0,
                    })}
                  </span>
                </>
              )}
              <span>·</span>
              <span>
                {t('organizer.bracketPage.summaryMatchSlots', { count: bracket.totalSlots })}
              </span>
              {bracket.phaseType === 'double_elim' && (
                <>
                  <span>·</span>
                  <span className="text-info">{t('organizer.bracketPage.summaryDoubleElim')}</span>
                </>
              )}
              {bronzeMatch && (
                <>
                  <span>·</span>
                  <span className="text-gold-text">
                    {t('organizer.bracketPage.summaryBronzeMatch')}
                  </span>
                </>
              )}
            </div>
            {podium && (
              <div className="mb-4 rounded-xl border border-border bg-surface p-4">
                <MedalPodium
                  podium={podium}
                  showBronze={!!bronzeMatch}
                  labels={{
                    title: t('organizer.phaseVisibility.podiumTitle'),
                    gold: t('organizer.phaseVisibility.podiumGold'),
                    silver: t('organizer.phaseVisibility.podiumSilver'),
                    bronze: t('organizer.phaseVisibility.podiumBronze'),
                    fourth: t('organizer.phaseVisibility.podiumFourth'),
                    tbd: t('organizer.phaseVisibility.podiumTbd'),
                  }}
                />
              </div>
            )}
            <div className="rounded-xl border border-border bg-surface p-4">
              <BracketView
                slots={bracket.slots
                  .filter((s) => s.id !== bronzeMatch?.id)
                  .map((s) => ({
                    ...s,
                    liceName: s.liceId ? (liceNameById.get(s.liceId) ?? null) : null,
                  }))}
                rounds={bracket.rounds}
                bracketConfig={bracketConfig}
                redColor={redColor}
                blueColor={blueColor}
                bronzeMatch={
                  bronzeMatch
                    ? {
                        ...bronzeMatch,
                        liceName: bronzeMatch.liceId
                          ? (liceNameById.get(bronzeMatch.liceId) ?? null)
                          : null,
                      }
                    : bronzeMatch
                }
                weapon={tournamentWeapon}
                bracketSize={bracket.bracketSize}
                onMatchClick={(matchId, slotId) => {
                  // Empty slot → override modal so the operator can
                  // place fighters. Match exists → jump straight into
                  // the match-direct scoring pad. The match-direct route
                  // works without a lice context, so no liceId branching
                  // is needed — the operator always lands on the
                  // specific match they clicked. The audit / forfeit
                  // page is no longer the fallback — operators reach it
                  // via the WO chip on each card.
                  if (!matchId) {
                    openOverride(slotId);
                    return;
                  }
                  // Same-origin proxy at `/scoring/*` serves the scoring
                  // PWA; externalDisplay carries the read-only admin
                  // scoreboard URL so the operator can open the
                  // projection screen in a new tab.
                  const scoreboardHref = `/display/${matchId}`;
                  const href = buildMatchScoringHref(
                    '/scoring',
                    matchId,
                    window.location.href,
                    scoreboardHref,
                  );
                  if (href) window.location.href = href;
                }}
                onOverrideSlot={(slotId) => openOverride(slotId)}
                playInLabel={t('organizer.phaseVisibility.playIns')}
              />
            </div>
          </div>
        )}

        {!bracket && !generating && (
          <div className="text-center py-14 px-8 bg-surface border border-border rounded-xl shadow-sm">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-gold/10 flex items-center justify-center text-2xl">
              🏆
            </div>
            <h3 className="font-display font-semibold text-lg sm:text-xl text-foreground mb-1">
              {t('organizer.bracketPage.emptyTitle')}
            </h3>
            <p className="text-muted text-sm mb-5 max-w-md mx-auto">
              {t('organizer.bracketPage.emptyBody')}
            </p>
            <button
              onClick={() => void generate(false)}
              disabled={generating || !selectedTournament}
              className="inline-flex items-center gap-2 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-50 px-4 py-2 text-sm font-semibold text-accent-foreground"
            >
              {t('organizer.bracketPage.generateButton')}
            </button>
          </div>
        )}
      </div>
      {/* R5: end of bracket-tab content wrapper */}
    </main>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function winnerName(
  slot: BracketSlotData,
): { fighterName: string; clubAbbrev?: string | null } | null {
  if (slot.redScore === null || slot.blueScore === null) return null;
  if (slot.redScore > slot.blueScore && slot.redFighterName) {
    return { fighterName: slot.redFighterName, clubAbbrev: slot.redClubAbbrev };
  }
  if (slot.blueScore > slot.redScore && slot.blueFighterName) {
    return { fighterName: slot.blueFighterName, clubAbbrev: slot.blueClubAbbrev };
  }
  return null;
}

function loserName(
  slot: BracketSlotData,
): { fighterName: string; clubAbbrev?: string | null } | null {
  if (slot.redScore === null || slot.blueScore === null) return null;
  if (slot.redScore > slot.blueScore && slot.blueFighterName) {
    return { fighterName: slot.blueFighterName, clubAbbrev: slot.blueClubAbbrev };
  }
  if (slot.blueScore > slot.redScore && slot.redFighterName) {
    return { fighterName: slot.redFighterName, clubAbbrev: slot.redClubAbbrev };
  }
  return null;
}

function strategyKey(s: SeedingStrategy): string {
  switch (s) {
    case 'snake':
      return 'Snake';
    case 'by-rating':
      return 'ByRating';
    case 'random':
      return 'Random';
    case 'by-pool-rank':
      return 'ByPoolRank';
  }
}
