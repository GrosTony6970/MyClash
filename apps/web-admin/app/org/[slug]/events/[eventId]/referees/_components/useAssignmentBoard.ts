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
import { assignFailureText, type PickerReason } from '@/lib/referee-reasons';
export interface AssignmentBoardCandidate {
  userId: string | null;
  /** `global_persons.id`: the referee's identity, and what an assign sends. */
  personId: string;
  displayName: string;
  clubLabel: string | null;
  qualifications: Array<{ role: string; rating: number | null }>;
}

/**
 * A candidate as the picker lists them for one slot: their bouts on the slot's day (ADR-019);
 * null when the slot has no time yet.
 */
export type PickerCandidate = AssignmentBoardCandidate & { boutsThatDay: number | null };

export interface AssignmentBoardRoleSlot {
  slotIndex: number;
  displayName: string | null;
  allowedSkillIds: string[];
  role: string;
  assignment: {
    id: string;
    /** Null for an unclaimed referee. */
    userId: string | null;
    personId: string | null;
    displayName: string;
    status: string;
    autoAssigned: boolean;
  } | null;
  missingReasons: string[];
  /** Sorted by the one checker's verdict (ADR-016). */
  candidates: {
    recommended: PickerCandidate[];
    /** Discouraged: may be assigned after confirming. */
    warning: Array<PickerCandidate & { reasons: PickerReason[] }>;
    /** Impossible, or holding no skill this slot allows. */
    blocked: Array<PickerCandidate & { reasons: PickerReason[] }>;
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
  /** `confirm` goes ahead over Discouraged reasons the organiser has seen (ADR-016). */
  manualAssign: (
    poolId: string,
    role: string,
    personId: string,
    confirm?: boolean,
  ) => Promise<boolean>;
  unassign: (assignmentId: string) => Promise<void>;
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
    async (poolId: string, role: string, personId: string, confirm = false): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const r = await apiRequest<AssignmentBoard>(
          apiUrl,
          `/api/v1/events/${eventId}/referee-assignments`,
          { method: 'POST', body: { poolId, role, personId, ...(confirm ? { confirm } : {}) } },
        );
        if (!r.ok) {
          // The one checker refuses by reason (ADR-016) — the sentence the operator
          // needs in order to pick somebody else, or confirm.
          setError(assignFailureText(t, r, messages.mutationFailed));
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
  };
}
