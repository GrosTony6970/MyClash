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
  const [board, setBoard] = useState<AssignmentBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<RefereeSkill[]>([]);
  const [liceNameById, setLiceNameById] = useState<Map<string, string>>(() => new Map());

  // Lice names. Silent on failure: the consumer renders no label, never a UUID.
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiUrl}/api/v1/events/${eventId}/lices`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const lices = (await res.json()) as Array<{ id: string; name: string }>;
        setLiceNameById(new Map(lices.map((lice) => [lice.id, lice.name])));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [apiUrl, eventId]);

  // Skills catalogue: chips tint by the skill's own colour and the role label
  // renders the human name instead of the raw id.
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiUrl}/api/v1/events/${eventId}/referee-skills`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        setSkills((await res.json()) as RefereeSkill[]);
      })
      .catch(() => undefined);
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
      try {
        const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/referee-assignment-board`, {
          credentials: 'include',
          signal,
        });
        if (!res.ok) throw new Error(messages.loadFailed);
        setBoard((await res.json()) as AssignmentBoard);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : messages.loadFailed);
      } finally {
        setLoading(false);
      }
    },
    [apiUrl, eventId, messages.loadFailed],
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
        const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/referee-assignments`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ poolId, role, userId }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? messages.mutationFailed);
        }
        setBoard((await res.json()) as AssignmentBoard);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : messages.mutationFailed);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [apiUrl, eventId, messages.mutationFailed],
  );

  const unassign = useCallback(
    async (assignmentId: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`${apiUrl}/api/v1/referee-assignments/${assignmentId}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? messages.mutationFailed);
        }
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : messages.mutationFailed);
      } finally {
        setBusy(false);
      }
    },
    [apiUrl, messages.mutationFailed, load],
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
      try {
        if (oldId) {
          const res = await fetch(`${apiUrl}/api/v1/referee-assignments/${oldId}`, {
            method: 'DELETE',
            credentials: 'include',
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { message?: string };
            throw new Error(body.message ?? messages.mutationFailed);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : messages.mutationFailed);
        setBusy(false);
        return;
      }
      setBusy(false);
      await manualAssign(suggestion.fromPoolId, slot.role, suggestion.toPersonId);
    },
    [allBoardPools, apiUrl, messages.mutationFailed, manualAssign],
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
