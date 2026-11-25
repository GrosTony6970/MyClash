'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, type ApiFailure } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { teamTournamentOf, type Team, type TeamTournament } from './team-form';

const apiUrl = getPublicApiUrl();

/** A write's answer: done, or the refusal for the screen to word. */
export type TeamWrite = { ok: true } | { ok: false; failure: ApiFailure };

/** The Event's team Tournaments, in list order; null until the list lands. */
export function useTeamTournaments(eventId: string) {
  const [tournaments, setTournaments] = useState<TeamTournament[] | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const path = `/api/v1/events/${eventId}/tournaments`;
    void apiRequest<Array<Record<string, unknown>>>(apiUrl, path, {
      signal: controller.signal,
    }).then((r) => {
      if (r.ok) setTournaments(r.data.flatMap((row) => teamTournamentOf(row) ?? []));
      else setFailure(r);
    });
    return () => controller.abort();
  }, [eventId]);
  return { tournaments, failure };
}

/**
 * The teams of one team Tournament, read again after each write.
 *
 * THE RACE: a read sent before a write can land after the read sent after it. Only the newest
 * read's answer is kept. (A switch of Tournament mounts a new panel, so a read of the last one
 * lands nowhere.)
 */
function useTeamList(tournamentId: string) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loadFailure, setLoadFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const latestRead = useRef(0);
  const reload = useCallback(async () => {
    const read = ++latestRead.current;
    const r = await apiRequest<Team[]>(apiUrl, `/api/v1/tournaments/${tournamentId}/teams`);
    if (read !== latestRead.current) return;
    setLoading(false);
    setLoadFailure(r.ok ? null : r);
    if (r.ok) setTeams(r.data);
  }, [tournamentId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the read's answer is set after it lands, not synchronously
    void reload();
  }, [reload]);
  return { teams, loading, loadFailure, reload };
}

/** The teams of one team Tournament, and the writes on them (`tournaments/:id/teams`, T3). */
export function useTeams(tournamentId: string) {
  const list = useTeamList(tournamentId);
  const base = `/api/v1/tournaments/${tournamentId}/teams`;
  type Init = Parameters<typeof apiRequest>[2];
  const write = async (path: string, init: Init): Promise<TeamWrite> => {
    const r = await apiRequest(apiUrl, `${base}${path}`, init);
    if (!r.ok) return { ok: false, failure: r };
    await list.reload();
    return { ok: true };
  };
  return {
    ...list,
    create: (body: Record<string, unknown>) => write('', { method: 'POST', body }),
    update: (teamId: string, body: Record<string, unknown>) =>
      write(`/${teamId}`, { method: 'PATCH', body }),
    remove: (teamId: string) => write(`/${teamId}`, { method: 'DELETE' }),
    /** A team's logo: an upload (multipart, as the Tournament logo), or a removal (null). */
    logoOf: (teamId: string) => ({
      upload: (file: File) => {
        const body = new FormData();
        body.append('file', file);
        return write(`/${teamId}/logo`, { method: 'POST', body });
      },
      remove: () => write(`/${teamId}`, { method: 'PATCH', body: { logoUrl: null } }),
    }),
  };
}
