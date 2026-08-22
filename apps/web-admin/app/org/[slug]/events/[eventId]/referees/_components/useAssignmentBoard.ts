'use client';

/**
 * The referee assignment board, as every tab that renders it needs it.
 *
 * The pools, bracket and Swiss tabs all show slot cards over the SAME
 * `GET /events/:eventId/referee-assignment-board` payload; they differ only in
 * which `kind` of unit they filter to and how they group them. Everything else
 * — the fetch, the skills catalogue, the lice-name map, assign, unassign, apply
 * a swap suggestion — was copied verbatim into each tab, three times, with three
 * chances to fix a bug in only two of them.
 *
 * The only thing that legitimately differs is the copy, because each page has
 * its own i18n namespace — and there are TWO messages, not one: "could not load
 * the board" and "could not save that assignment" say different things to an
 * operator, and collapsing them would have made a failed assign report a
 * loading problem.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
// Type-only, so importing from a 'use client' component module is erased at
// build time. Kept as the single definition rather than re-declared narrowly
// here: the panel that renders these is the one that decides their shape.
import type { SwapSuggestion } from './SwapSuggestionsPanel';

export interface AssignmentBoardCandidate {
  userId: string;
  personId: string | null;
  displayName: string;
  clubLabel: string | null;
  qualifications: Array<{ role: string; rating: number | null }>;
  workload: number;
}

export interface AssignmentBoardRoleSlot {
  slotIndex: number;
  displayName: string | null;
  allowedSkillIds: string[];
  role: string;
  assignment: {
    id: string;
    userId: string;
    personId: string | null;
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

export interface AssignmentBoardPool {
  id: string;
  name: string;
  tournamentId: string;
  tournamentName: string;
  liceId: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  /** Which kind of unit this is. Default 'pool' for any caller that predates it. */
  kind?: 'pool' | 'swiss' | 'bracket' | 'finals';
  /** Every bout the unit covers. A Swiss (round × piste) unit wraps several. */
  matchIds?: string[];
  /** Swiss units only: which round, and its id (for the per-round bulk clear). */
  swissRound?: number;
  swissRoundId?: string;
  members: Array<{
    registrationId: string;
    personId: string;
    personName: string;
    clubLabel?: string | null;
  }>;
  roleSlots: AssignmentBoardRoleSlot[];
}

export interface AssignmentBoard {
  pools: AssignmentBoardPool[];
  unscheduledPools: AssignmentBoardPool[];
  candidates: AssignmentBoardCandidate[];
  locked: boolean;
  swapSuggestions?: SwapSuggestion[];
}

interface RefereeSkill {
  id: string;
  name: string;
  color: string;
}

export interface UseAssignmentBoard {
  board: AssignmentBoard | null;
  /** Scheduled + unscheduled units in one list — every tab filters this. */
  allBoardPools: AssignmentBoardPool[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  setError: (message: string | null) => void;
  skillNameById: Map<string, string>;
  skillColorById: Map<string, string>;
  liceNameById: Map<string, string>;
  reload: () => Promise<void>;
  manualAssign: (poolId: string, role: string, userId: string) => Promise<boolean>;
  unassign: (assignmentId: string) => Promise<void>;
  applySwap: (suggestion: SwapSuggestion) => Promise<void>;
}

export interface AssignmentBoardMessages {
  /** The board itself could not be fetched. */
  loadFailed: string;
  /** An assign / unassign / swap did not persist. */
  mutationFailed: string;
}

export function useAssignmentBoard(
  eventId: string,
  messages: AssignmentBoardMessages,
): UseAssignmentBoard {
  const apiUrl = getPublicApiUrl();
  // `messages` carries this screen's own sentences, already translated. `t` is
  // here for the seam's mapper, which names KEYS and takes the translator.
  const { t } = useI18n();
  const [board, setBoard] = useState<AssignmentBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<RefereeSkill[]>([]);
  const [liceNameById, setLiceNameById] = useState<Map<string, string>>(() => new Map());

  // Lice names. Silent on failure: the consumer renders no label, never a UUID.
  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<Array<{ id: string; name: string }>>(
      apiUrl,
      `/api/v1/events/${eventId}/lices`,
      { signal: controller.signal },
    ).then((r) => {
      if (!r.ok) return;
      setLiceNameById(new Map(r.data.map((lice) => [lice.id, lice.name])));
    });
    return () => controller.abort();
  }, [apiUrl, eventId]);

  // Skills catalogue: chips tint by the skill's own colour and the role label
  // renders the human name instead of the raw id.
  useEffect(() => {
    const controller = new AbortController();
    // Silent too: without the catalogue a chip keeps the default tint and the
    // role renders its built-in label, which is the same resolution chain an
    // event with no custom skills already runs.
    void apiRequest<RefereeSkill[]>(apiUrl, `/api/v1/events/${eventId}/referee-skills`, {
      signal: controller.signal,
    }).then((r) => {
      if (r.ok) setSkills(r.data);
    });
    return () => controller.abort();
  }, [apiUrl, eventId]);

  const skillNameById = useMemo(
    () => new Map(skills.filter((s) => s.name).map((s) => [s.id, s.name])),
    [skills],
  );
  const skillColorById = useMemo(
    () => new Map(skills.filter((s) => s.color).map((s) => [s.id, s.color])),
    [skills],
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      const r = await apiRequest<AssignmentBoard>(
        apiUrl,
        `/api/v1/events/${eventId}/referee-assignment-board`,
        signal ? { signal } : {},
      );
      // The workspace unmounted, or moved to another event. A newer load owns
      // the spinner now.
      if (!r.ok && r.kind === 'aborted') return;
      setLoading(false);
      if (!r.ok) {
        // Was one fixed sentence for every refusal alike, including the 403
        // that names the event scope the operator is missing.
        setError(failureMessage(r, t, messages.loadFailed));
        return;
      }
      setBoard(r.data);
    },
    [apiUrl, eventId, messages.loadFailed, t],
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch lifecycle: load sets state only after the awaited request resolves
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const allBoardPools = useMemo(
    () => (board ? [...board.pools, ...board.unscheduledPools] : []),
    [board],
  );

  /** Resolves true when the assignment persisted, so a caller can close its picker. */
  const manualAssign = useCallback(
    async (poolId: string, role: string, userId: string): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const r = await apiRequest<AssignmentBoard>(
          apiUrl,
          `/api/v1/events/${eventId}/referee-assignments`,
          { method: 'POST', body: { poolId, role, userId } },
        );
        if (!r.ok) {
          // Hard rule 8 refuses this by name — the person is fighting in a
          // pool that overlaps the one they would referee — and that is the
          // sentence the operator needs to pick somebody else.
          setError(failureMessage(r, t, messages.mutationFailed));
          return false;
        }
        setBoard(r.data);
        return true;
      } finally {
        setBusy(false);
      }
    },
    [apiUrl, eventId, messages.mutationFailed, t],
  );

  const unassign = useCallback(
    async (assignmentId: string) => {
      setBusy(true);
      setError(null);
      try {
        const r = await apiRequest(apiUrl, `/api/v1/referee-assignments/${assignmentId}`, {
          method: 'DELETE',
        });
        if (!r.ok) {
          setError(failureMessage(r, t, messages.mutationFailed));
          return;
        }
        await load();
      } finally {
        setBusy(false);
      }
    },
    [apiUrl, messages.mutationFailed, load, t],
  );

  /**
   * Apply a back-to-back swap proposal: unassign, then assign the replacement.
   * The board's slot list resolves the outgoing assignment id from
   * (poolId, slotIndex) — the suggestion itself carries neither.
   */
  const applySwap = useCallback(
    async (suggestion: SwapSuggestion) => {
      const pool = allBoardPools.find((p) => p.id === suggestion.fromPoolId);
      const slot = pool?.roleSlots.find((rs) => rs.slotIndex === suggestion.fromSlotIndex);
      if (!slot) return;
      const oldId = slot.assignment?.id;
      setBusy(true);
      setError(null);
      if (oldId) {
        const r = await apiRequest(apiUrl, `/api/v1/referee-assignments/${oldId}`, {
          method: 'DELETE',
        });
        // The swap stops here rather than assigning the replacement on top of
        // an assignment that is still standing.
        if (!r.ok) {
          setError(failureMessage(r, t, messages.mutationFailed));
          setBusy(false);
          return;
        }
      }
      setBusy(false);
      await manualAssign(suggestion.fromPoolId, slot.role, suggestion.toPersonId);
    },
    [allBoardPools, apiUrl, messages.mutationFailed, manualAssign, t],
  );

  return {
    board,
    allBoardPools,
    loading,
    busy,
    error,
    setError,
    skillNameById,
    skillColorById,
    liceNameById,
    reload: load,
    manualAssign,
    unassign,
    applySwap,
  };
}
