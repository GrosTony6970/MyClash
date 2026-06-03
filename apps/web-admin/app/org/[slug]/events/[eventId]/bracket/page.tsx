'use client';

/* eslint-disable myclash/no-literal-string */

/**
 * Bracket management — T-704 / auto-advance
 * Route: /org/[slug]/events/[eventId]/bracket
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  BracketView,
  MedalPodium,
  TournamentColorDot,
  type BracketSlotData,
  type BracketConfig,
  type ColorToken,
  type PodiumData,
} from '@myclash/ui';
import { useRealtimeWithFallback } from '@/lib/supabase-browser';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import { useEventStatus } from '../_hooks/useEventStatus';
import { RefereesTab as BracketRefereesTab } from './_tabs/RefereesTab';
import { buildMatchScoringHref } from '../pools/_tabs/build-scoring-href';
import { requireClientEnv } from '../../../../../../src/config/client-env';

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
  seedingStrategy?: string;
  bronzeSlotId?: string | null;
  totalSlots: number;
  slots: BracketSlotData[];
}

interface OverrideModalState {
  slotId: string;
  /**
   * Tri-state values:
   *   - undefined: untouched in this modal session, omitted from the PATCH.
   *   - null: explicit clear (sends `registrationAId: null`).
   *   - string: registration UUID to assign.
   */
  regAId: string | null | undefined;
  regBId: string | null | undefined;
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
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  // Cross-app deep link into the web-scoring ScoringPad — same env var
  // the pool Matches tab reads. requireClientEnv throws in prod when
  // missing so a forgotten Dockerfile ARG can't ship as a silent
  // localhost fallback. The literal below is the dev fallback.
  // Pass `process.env.NEXT_PUBLIC_SCORING_URL` directly so Next.js
  // inlines the value at build time — see requireClientEnv's docs.
  const scoringBaseUrl = requireClientEnv(
    process.env['NEXT_PUBLIC_SCORING_URL'],
    'NEXT_PUBLIC_SCORING_URL',
    'http://localhost:3002',
  );
  const { t } = useI18n();
  const { isReadOnly } = useEventStatus(eventId);

  // ── R5: tab state ─────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<BracketTabKey>('bracket');
  useEffect(() => {
    setActiveTab(readBracketHashTab());
    function onHash() {
      setActiveTab(readBracketHashTab());
    }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  function selectTab(key: BracketTabKey) {
    window.location.hash = `#${key}`;
  }

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedTournament, setSelectedTournament] = useState<string>('');
  const [bracket, setBracket] = useState<BracketResult | null>(null);
  const [bracketPhaseId, setBracketPhaseId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<'hidden' | 'published'>('hidden');
  const [existingBracket, setExistingBracket] = useState(false);
  const [redColor, setRedColor] = useState<ColorToken>('red');
  const [blueColor, setBlueColor] = useState<ColorToken>('blue');
  const [tournamentWeapon, setTournamentWeapon] = useState<string | null>(null);

  // Config
  const [qualifyCount, setQualifyCount] = useState<number | ''>('');
  const [bracketSize, setBracketSize] = useState<number | ''>('');
  const [phaseType, setPhaseType] = useState<'single_elim' | 'double_elim'>('single_elim');
  const [grandFinalReset, setGrandFinalReset] = useState(false);
  const [seedingStrategy, setSeedingStrategy] = useState<SeedingStrategy>('snake');

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
  const [forfeitModal, setForfeitModal] = useState<{
    matchId: string;
    redRegistrationId: string | null;
    redName: string | null;
    blueRegistrationId: string | null;
    blueName: string | null;
  } | null>(null);
  const [forfeitSide, setForfeitSide] = useState<'red' | 'blue' | null>(null);
  const [forfeitReason, setForfeitReason] = useState<ForfeitReason>('voluntary');
  const [forfeitBusy, setForfeitBusy] = useState(false);
  const [forfeitError, setForfeitError] = useState<string | null>(null);

  function closeForfeitModal() {
    setForfeitModal(null);
    setForfeitSide(null);
    setForfeitReason('voluntary');
    setForfeitError(null);
  }

  async function submitForfeit() {
    if (!forfeitModal || !forfeitSide) return;
    const forfeitingRegistrationId =
      forfeitSide === 'red' ? forfeitModal.redRegistrationId : forfeitModal.blueRegistrationId;
    if (!forfeitingRegistrationId) {
      setForfeitError('This side has no registration id yet.');
      return;
    }
    setForfeitBusy(true);
    setForfeitError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/matches/${forfeitModal.matchId}/forfeit`, {
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
      closeForfeitModal();
      refreshBracket();
    } catch (err) {
      setForfeitError(err instanceof Error ? err.message : 'Forfeit failed');
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
  const [pickerFilter, setPickerFilter] = useState('');

  // Configuration card (post-generation edit)
  const [editGrandFinalReset, setEditGrandFinalReset] = useState(false);
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
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [showForceConfirm, setShowForceConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showUnpublishConfirm, setShowUnpublishConfirm] = useState(false);
  const [notifyHref, setNotifyHref] = useState<string | null>(null);
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
        if (tournaments.length > 0) setTimeout(() => setSelectedTournament(tournaments[0]!.id), 0);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [eventId, apiUrl]);

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
          setVisibility(data.visibility ?? 'hidden');
          setExistingBracket(true);
          if (data.phaseType === 'double_elim') setPhaseType('double_elim');
          setEditGrandFinalReset(Boolean(data.grandFinalReset));
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
    const q = pickerFilter.trim().toLowerCase();
    if (!q) return pickerRegistrations;
    return pickerRegistrations.filter((r) => r.displayName.toLowerCase().includes(q));
  }, [pickerRegistrations, pickerFilter]);

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
      if (phaseType === 'double_elim') body['grandFinalReset'] = grandFinalReset;

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
        throw new Error(errBody.message ?? 'Generation failed');
      }

      const result = (await res.json()) as BracketResult;
      setBracket(result);
      setBracketPhaseId(result.phaseId);
      setVisibility('hidden');
      setNotifyHref(null);
      setExistingBracket(true);
      setEditGrandFinalReset(Boolean(result.grandFinalReset));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
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
        const msg =
          res.status === 409
            ? t('organizer.bracket.autoPopulatePoolsNotFinished')
            : (errBody?.message ?? 'Populate failed');
        throw new Error(msg);
      }
      setPopulateMessage(t('organizer.bracket.autoPopulateSuccess'));
      refreshBracket();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Populate failed');
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
        throw new Error(errBody?.message ?? 'Delete failed');
      }
      // Drop client state and fall back to the empty state.
      setBracket(null);
      setBracketPhaseId(null);
      setVisibility('hidden');
      setNotifyHref(null);
      setExistingBracket(false);
      setShowDeleteConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  async function updateVisibility(nextVisibility: 'hidden' | 'published', confirmStarted = false) {
    if (!bracketPhaseId || visibilityBusy) return;
    setVisibilityBusy(true);
    setError(null);
    setShowUnpublishConfirm(false);
    try {
      const res = await fetch(`${apiUrl}/api/v1/phases/${bracketPhaseId}/visibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ visibility: nextVisibility, confirmStarted }),
      });
      if (res.status === 409 && nextVisibility === 'hidden') {
        setShowUnpublishConfirm(true);
        return;
      }
      if (!res.ok) {
        const errBody = (await res.json()) as { message?: string };
        throw new Error(errBody.message ?? t('organizer.phaseVisibility.updateError'));
      }
      setVisibility(nextVisibility);
      if (nextVisibility === 'published') {
        const query = new URLSearchParams({
          targetType: 'fighters_and_referees',
          severity: 'info',
          tournamentId: selectedTournament,
          title: t('organizer.phaseVisibility.bracketReadyTitle'),
          body: t('organizer.phaseVisibility.bracketReadyBody'),
        });
        setNotifyHref(`/org/${slug}/events/${eventId}/notifications?${query.toString()}`);
      } else {
        setNotifyHref(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.phaseVisibility.updateError'));
    } finally {
      setVisibilityBusy(false);
    }
  }

  async function submitOverride() {
    if (!overrideModal) return;
    setOverriding(true);
    setOverrideError(null);
    try {
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
        throw new Error(errBody.message ?? 'Override failed');
      }
      setOverrideModal(null);
      setPickerFilter('');
      refreshBracket();
    } catch (err) {
      setOverrideError(err instanceof Error ? err.message : 'Override failed');
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
        body: JSON.stringify({ grandFinalReset: editGrandFinalReset }),
      });
      if (res.status === 409) {
        setConfigError(t('organizer.phaseVisibility.configLocked'));
        return;
      }
      if (!res.ok) {
        const errBody = (await res.json()) as { message?: string };
        throw new Error(errBody.message ?? 'Could not save configuration');
      }
      refreshBracket();
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : 'Could not save configuration');
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
        setReseedError(errBody.message ?? 'Strategy not implemented');
        return;
      }
      if (!res.ok) {
        const errBody = (await res.json()) as { message?: string };
        throw new Error(errBody.message ?? 'Reseed failed');
      }
      setReseedMessage(t('organizer.phaseVisibility.reseedSuccess'));
      setReseedOpen(false);
      refreshBracket();
    } catch (err) {
      setReseedError(err instanceof Error ? err.message : 'Reseed failed');
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
    if (!bracket || bracket.phaseType !== 'single_elim') {
      return {
        bronzeMatch: null as BracketSlotData | null,
        podium: undefined as PodiumData | undefined,
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
    <main className="px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href={`/org/${slug}`} className="hover:text-gray-700">
              {slug}
            </Link>
            <span>/</span>
            <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-gray-700">
              Event
            </Link>
            <span>/</span>
            <span className="text-gray-900 font-medium">Bracket</span>
          </div>
          <h1 className="text-2xl font-bold">Bracket management</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/org/${slug}/events/${eventId}/ai-assistant?type=bracket_plan${selectedTournament ? `&tournamentId=${selectedTournament}` : ''}`}
            className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            {t('organizer.aiAssistant.suggest')}
          </Link>
          <Link
            href={`/org/${slug}/events/${eventId}/pools`}
            className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            ← Pools
          </Link>
        </div>
      </div>

      {/* R5: tab nav */}
      <nav aria-label="Bracket sections" className="mb-6 flex gap-1 border-b border-slate-200">
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
                  ? 'border-red-800 text-red-800'
                  : disabled
                    ? 'border-transparent text-slate-300 cursor-not-allowed'
                    : 'border-transparent text-slate-600 hover:text-slate-900',
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
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
            <span
              className={[
                'rounded-full px-2.5 py-1 text-xs font-semibold',
                visibility === 'published'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-600',
              ].join(' ')}
            >
              {visibility === 'published'
                ? t('organizer.phaseVisibility.published')
                : t('organizer.phaseVisibility.hidden')}
            </span>
            <button
              type="button"
              disabled={visibilityBusy || visibility === 'published'}
              onClick={() => void updateVisibility('published')}
              className="rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-gray-300"
            >
              {t('organizer.phaseVisibility.publishBracket')}
            </button>
            <button
              type="button"
              disabled={visibilityBusy || visibility === 'hidden'}
              onClick={() => void updateVisibility('hidden')}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 disabled:text-gray-300"
            >
              {t('organizer.phaseVisibility.unpublishBracket')}
            </button>
            {notifyHref && (
              <Link href={notifyHref} className="text-sm font-semibold text-red-700 underline">
                {t('organizer.phaseVisibility.notifyParticipants')}
              </Link>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setReseedOpen(true)}
                disabled={r1HasStartedMatch}
                title={r1HasStartedMatch ? t('organizer.phaseVisibility.reseedBlocked') : undefined}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 disabled:opacity-40"
              >
                {t('organizer.phaseVisibility.reseedButton')}
              </button>
            </div>
            {bracket?.autoAdvance === false && (
              <span className="rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-semibold text-yellow-700">
                Manual mode
              </span>
            )}
          </div>
        )}

        {showUnpublishConfirm && (
          <div className="mb-6 rounded-xl border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
            <p className="font-semibold">
              {t('organizer.phaseVisibility.unpublishStartedWarning')}
            </p>
            <button
              type="button"
              onClick={() => void updateVisibility('hidden', true)}
              className="mt-3 rounded-lg bg-yellow-600 px-3 py-2 text-sm font-semibold text-white"
            >
              {t('organizer.phaseVisibility.confirmUnpublish')}
            </button>
          </div>
        )}

        {/* Tournament selector */}
        {tournaments.length > 1 && (
          <div className="mb-4 flex items-center gap-2">
            <TournamentColorDot
              color={tournaments.find((t) => t.id === selectedTournament)?.color}
              size="md"
            />
            <select
              value={selectedTournament}
              onChange={(e) => setSelectedTournament(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            >
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Generate config */}
        {!existingBracket && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 mb-6">
            <h2 className="text-sm font-bold text-gray-700 mb-4">Bracket configuration</h2>
            <div className="flex flex-wrap gap-6 items-end">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Format</label>
                <select
                  value={phaseType}
                  onChange={(e) => setPhaseType(e.target.value as 'single_elim' | 'double_elim')}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                >
                  <option value="single_elim">Single elimination</option>
                  <option value="double_elim">Double elimination</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Qualify count (top N from pools)
                </label>
                <input
                  type="number"
                  value={qualifyCount}
                  onChange={(e) =>
                    setQualifyCount(e.target.value === '' ? '' : parseInt(e.target.value))
                  }
                  placeholder="Auto"
                  min="2"
                  className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
                <p className="mt-1 max-w-xs text-xs text-gray-500">
                  {phaseType === 'single_elim'
                    ? `Auto uses play-ins for non-power-of-two counts. Main bracket size is capped at ${MAX_BRACKET_SIZE}.`
                    : `Double elimination bracket size is capped at ${MAX_BRACKET_SIZE}.`}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Bracket size override (power of 2, max {MAX_BRACKET_SIZE})
                </label>
                <select
                  value={bracketSize}
                  onChange={(e) =>
                    setBracketSize(e.target.value === '' ? '' : parseInt(e.target.value))
                  }
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                >
                  <option value="">Auto</option>
                  {BRACKET_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {t('organizer.phaseVisibility.seedingStrategyLabel')}
                </label>
                <select
                  value={seedingStrategy}
                  onChange={(e) => setSeedingStrategy(e.target.value as SeedingStrategy)}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                >
                  <option value="snake">
                    {t('organizer.phaseVisibility.seedingStrategySnake')}
                  </option>
                  <option value="by-rating" disabled>
                    {t('organizer.phaseVisibility.seedingStrategyByRating')}
                  </option>
                  <option value="random" disabled>
                    {t('organizer.phaseVisibility.seedingStrategyRandom')}
                  </option>
                  <option value="by-pool-rank" disabled>
                    {t('organizer.phaseVisibility.seedingStrategyByPoolRank')}
                  </option>
                </select>
              </div>
              {phaseType === 'double_elim' && (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={grandFinalReset}
                    onChange={(e) => setGrandFinalReset(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-gray-700">Grand final reset</span>
                </label>
              )}
              <button
                onClick={() => void generate(false)}
                disabled={generating || !selectedTournament}
                className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
              >
                {generating ? 'Generating…' : 'Generate bracket'}
              </button>
            </div>
          </div>
        )}

        {/* Configuration card (post-generation edit) */}
        {existingBracket && bracket && (
          <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="text-sm font-bold text-gray-700 mb-4">
              {t('organizer.phaseVisibility.configCardTitle')}
            </h2>
            <div className="flex flex-wrap items-end gap-6 text-sm">
              <div>
                <p className="text-xs text-gray-500">
                  {t('organizer.phaseVisibility.configBracketSize')}
                </p>
                <p className="font-mono text-gray-900">{bracket.bracketSize}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">
                  {t('organizer.phaseVisibility.configFighterCount')}
                </p>
                <p className="font-mono text-gray-900">{bracket.fighterCount}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">
                  {t('organizer.phaseVisibility.configPhaseType')}
                </p>
                <p className="font-mono text-gray-900">{bracket.phaseType}</p>
              </div>
              {bracket.phaseType === 'double_elim' && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editGrandFinalReset}
                    onChange={(e) => setEditGrandFinalReset(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-gray-700">
                    {t('organizer.phaseVisibility.configGrandFinalReset')}
                  </span>
                </label>
              )}
              {bracket.phaseType === 'double_elim' && (
                <button
                  onClick={() => void saveBracketConfig()}
                  disabled={configSaving}
                  className="rounded-lg bg-red-700 hover:bg-red-800 disabled:opacity-50 px-3 py-2 text-sm font-semibold text-white"
                >
                  {configSaving
                    ? t('organizer.phaseVisibility.configSaving')
                    : t('organizer.phaseVisibility.configSave')}
                </button>
              )}
              <button
                onClick={() => setShowForceConfirm(true)}
                disabled={generating || deleting}
                className="ml-auto rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50"
              >
                Regenerate bracket
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={generating || deleting}
                className="rounded-lg border border-red-200 bg-white hover:bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
              >
                Delete bracket
              </button>
            </div>

            {/* Auto-populate row: pick mode (overall / top-N per pool),
                optional N, click to fan pool standings into R1. Server
                gates on pool completion + R1-not-started. */}
            <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4 text-sm">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-500">
                  {t('organizer.bracket.autoPopulateButton')}
                </span>
                <select
                  value={populateMode}
                  onChange={(e) => setPopulateMode(e.target.value as 'overall' | 'top-n-per-pool')}
                  disabled={populating}
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                >
                  <option value="overall">{t('organizer.bracket.autoPopulateModeOverall')}</option>
                  <option value="top-n-per-pool">
                    {t('organizer.bracket.autoPopulateModeTopNPerPool')}
                  </option>
                </select>
              </label>
              {populateMode === 'top-n-per-pool' && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500">
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
                    className="w-20 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </label>
              )}
              <button
                type="button"
                onClick={() => void populateBracket()}
                disabled={populating || !existingBracket}
                className="rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 px-3 py-2 text-sm font-semibold text-white"
              >
                {populating ? '…' : t('organizer.bracket.autoPopulateButton')}
              </button>
              {populateMessage && <span className="text-xs text-green-700">{populateMessage}</span>}
            </div>
            {bracket.phaseType === 'double_elim' && (
              <p className="mt-3 text-xs text-gray-500">
                {t('organizer.phaseVisibility.configGrandFinalResetHint')}
              </p>
            )}
            {configError && <p className="mt-2 text-sm text-red-600">{configError}</p>}
            {reseedMessage && <p className="mt-2 text-sm text-emerald-600">{reseedMessage}</p>}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
            {error}
          </div>
        )}

        {/* Force confirm modal */}
        {showForceConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 text-center">
              <p className="text-4xl mb-3">⚠️</p>
              <h2 className="text-lg font-bold mb-2">Regenerate bracket?</h2>
              <p className="text-gray-500 text-sm mb-5">
                The existing bracket and all its match slots will be deleted.
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setShowForceConfirm(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void generate(true)}
                  className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white font-semibold rounded-lg text-sm"
                >
                  Yes, regenerate
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete confirm modal — distinct from regenerate: leaves no bracket behind. */}
        {showDeleteConfirm && bracket && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
              <p className="text-4xl mb-3 text-center">🗑️</p>
              <h2 className="text-lg font-bold mb-2 text-center">Delete this bracket?</h2>
              <p className="text-gray-600 text-sm mb-4 text-center">
                This will permanently remove:
              </p>
              <ul className="text-sm text-gray-700 mb-5 space-y-1 mx-auto max-w-[240px]">
                <li className="flex justify-between">
                  <span>Bracket slots</span>
                  <span className="font-mono text-gray-900">{bracket.slots?.length ?? 0}</span>
                </li>
                <li className="flex justify-between">
                  <span>Match records</span>
                  <span className="font-mono text-gray-900">{bracket.slots?.length ?? 0}</span>
                </li>
                <li className="flex justify-between text-gray-500">
                  <span>Referee assignments</span>
                  <span className="font-mono">cascaded</span>
                </li>
              </ul>
              <p className="text-xs text-gray-500 mb-5 text-center">
                You can re-create the bracket later from the registered fighters.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void deleteBracket()}
                  disabled={deleting}
                  className="flex-1 px-4 py-2 bg-red-700 hover:bg-red-800 text-white font-semibold rounded-lg text-sm disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Delete bracket'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Override modal — searchable registration picker. Two panes,
            one per side (A = red, B = blue). Each pane shows the same
            filtered list; clicking a row sets that side to the
            registration id; "Clear" sends an explicit null so the
            backend wipes the assignment. */}
        {forfeitModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
              <h2 className="text-lg font-bold mb-1">Record forfeit</h2>
              <p className="text-sm text-gray-500 mb-4">
                The selected side will be marked as forfeiting; the other side advances.
              </p>

              <div className="space-y-2 mb-4">
                {(['red', 'blue'] as const).map((side) => {
                  const name = side === 'red' ? forfeitModal.redName : forfeitModal.blueName;
                  const regId =
                    side === 'red'
                      ? forfeitModal.redRegistrationId
                      : forfeitModal.blueRegistrationId;
                  const disabled = !regId;
                  const active = forfeitSide === side;
                  return (
                    <button
                      key={side}
                      type="button"
                      disabled={disabled}
                      onClick={() => setForfeitSide(side)}
                      className={[
                        'w-full text-left rounded-lg border px-3 py-2 text-sm transition-colors',
                        active
                          ? 'border-red-600 bg-red-50 text-red-900'
                          : 'border-gray-300 hover:border-gray-400',
                        disabled ? 'opacity-50 cursor-not-allowed' : '',
                      ].join(' ')}
                    >
                      <span className="font-semibold">
                        {side === 'red' ? 'Red' : 'Blue'} forfeits
                      </span>
                      <span className="ml-2 text-gray-600">— {name ?? '?'}</span>
                    </button>
                  );
                })}
              </div>

              <label className="block text-xs font-semibold text-gray-600 mb-1">Reason</label>
              <select
                value={forfeitReason}
                onChange={(e) => setForfeitReason(e.target.value as ForfeitReason)}
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-red-600"
              >
                <option value="voluntary">Voluntary</option>
                <option value="injury">Injury</option>
                <option value="black_card_1">Black card (single)</option>
                <option value="black_card_2">Black card (two)</option>
                <option value="conduct_violation">Conduct violation</option>
              </select>

              {forfeitError && (
                <p className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                  {forfeitError}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeForfeitModal}
                  disabled={forfeitBusy}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:border-gray-400 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void submitForfeit()}
                  disabled={forfeitBusy || !forfeitSide}
                  className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                >
                  {forfeitBusy ? '…' : 'Confirm forfeit'}
                </button>
              </div>
            </div>
          </div>
        )}

        {overrideModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6">
              <h2 className="text-lg font-bold mb-3">
                {t('organizer.bracket.overrideModal.title')}
              </h2>
              <input
                type="text"
                value={pickerFilter}
                onChange={(e) => setPickerFilter(e.target.value)}
                placeholder={t('organizer.bracket.overrideModal.filterPlaceholder')}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-red-600"
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
                      className="flex flex-col rounded-lg border border-gray-200 bg-gray-50"
                    >
                      <div className="border-b border-gray-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        {sideLabel}
                      </div>
                      <div className="max-h-64 overflow-y-auto">
                        {filteredRegistrations.length === 0 ? (
                          <p className="px-3 py-3 text-xs italic text-gray-500">
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
                                  'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors border-b border-gray-100 last:border-b-0',
                                  active
                                    ? 'bg-red-50 text-red-900 font-semibold'
                                    : 'text-gray-700 hover:bg-white',
                                ].join(' ')}
                              >
                                <span className="truncate">{reg.displayName}</span>
                                {reg.bibNumber !== null && (
                                  <span className="shrink-0 rounded bg-gray-100 px-1 py-px text-[10px] text-gray-500">
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
                          'border-t border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-white',
                          currentId === null ? 'bg-red-50 text-red-700' : '',
                        ].join(' ')}
                      >
                        {t('organizer.bracket.overrideModal.clear')}
                      </button>
                    </div>
                  );
                })}
              </div>
              {overrideError && <p className="text-red-600 text-sm mb-3">{overrideError}</p>}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setOverrideModal(null);
                    setPickerFilter('');
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void submitOverride()}
                  disabled={overriding}
                  className="flex-1 px-4 py-2 bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold rounded-lg text-sm"
                >
                  {overriding ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Re-seed modal */}
        {reseedOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
              <h2 className="text-lg font-bold mb-2">
                {t('organizer.phaseVisibility.reseedTitle')}
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                {t('organizer.phaseVisibility.reseedHint')}
              </p>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {t('organizer.phaseVisibility.reseedStrategyLabel')}
              </label>
              <select
                value={reseedStrategy}
                onChange={(e) => setReseedStrategy(e.target.value as SeedingStrategy)}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 mb-4"
              >
                {SEEDING_STRATEGIES.map((s) => (
                  <option key={s} value={s} disabled={s !== 'snake'}>
                    {t(`organizer.phaseVisibility.seedingStrategy${strategyKey(s)}`)}
                  </option>
                ))}
              </select>
              {reseedError && <p className="text-red-600 text-sm mb-3">{reseedError}</p>}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setReseedOpen(false);
                    setReseedError(null);
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void submitReseed()}
                  disabled={reseedRunning || r1HasStartedMatch}
                  className="flex-1 px-4 py-2 bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold rounded-lg text-sm"
                >
                  {reseedRunning
                    ? t('organizer.phaseVisibility.reseedApplying')
                    : t('organizer.phaseVisibility.reseedApply')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bracket preview */}
        {bracket && (
          <div>
            <div className="flex flex-wrap items-center gap-4 mb-4 text-sm text-gray-500">
              <span>{bracket.bracketSize}-slot main bracket</span>
              <span>·</span>
              <span>{bracket.rounds} rounds</span>
              <span>·</span>
              <span>{bracket.byeCount} byes</span>
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
              <span>{bracket.totalSlots} match slots</span>
              {bracket.phaseType === 'double_elim' && (
                <>
                  <span>·</span>
                  <span className="text-blue-500">Double elim</span>
                </>
              )}
              {bronzeMatch && (
                <>
                  <span>·</span>
                  <span className="text-amber-700">Bronze match</span>
                </>
              )}
            </div>
            {podium && bracket.phaseType === 'single_elim' && (
              <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
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
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <BracketView
                slots={bracket.slots.filter((s) => s.id !== bronzeMatch?.id)}
                rounds={bracket.rounds}
                bracketConfig={bracketConfig}
                redColor={redColor}
                blueColor={blueColor}
                bronzeMatch={bronzeMatch}
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
                    setOverrideModal({ slotId, regAId: undefined, regBId: undefined });
                    return;
                  }
                  const scoringHref = buildMatchScoringHref(
                    scoringBaseUrl,
                    matchId,
                    window.location.href,
                  );
                  if (scoringHref) window.location.href = scoringHref;
                }}
                onOverrideSlot={(slotId) =>
                  setOverrideModal({ slotId, regAId: undefined, regBId: undefined })
                }
                onForfeitClick={(matchId, slot) => {
                  setForfeitModal({
                    matchId,
                    redRegistrationId: slot.redRegistrationId ?? null,
                    redName: slot.redFighterName,
                    blueRegistrationId: slot.blueRegistrationId ?? null,
                    blueName: slot.blueFighterName,
                  });
                }}
                playInLabel={t('organizer.phaseVisibility.playIns')}
              />
            </div>
          </div>
        )}

        {!bracket && !generating && (
          <div className="text-center py-14 px-8 bg-white border border-slate-200 rounded-xl shadow-sm">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center text-2xl">
              🏆
            </div>
            <h3 className="text-base font-semibold text-slate-900 mb-1">No bracket created yet</h3>
            <p className="text-slate-500 text-sm mb-5 max-w-md mx-auto">
              Configure the bracket above (phase type, size, and seeding), then click Generate to
              lock in the matchups for the registered fighters.
            </p>
            <button
              onClick={() => void generate(false)}
              disabled={generating || !selectedTournament}
              className="inline-flex items-center gap-2 rounded-lg bg-red-700 hover:bg-red-800 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white"
            >
              Generate bracket
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
