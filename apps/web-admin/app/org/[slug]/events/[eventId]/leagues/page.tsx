'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { t } from '@myclash/i18n';

interface League {
  id: string;
  name: string;
}

interface Tournament {
  id: string;
  name: string;
}

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export default function EventLeagueAttachmentPage() {
  const params = useParams<{ eventId: string }>();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [leagueId, setLeagueId] = useState('');
  const [tournamentId, setTournamentId] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    void Promise.all([
      fetch(`${apiUrl}/api/v1/leagues`).then((res) => res.json() as Promise<League[]>),
      fetch(`${apiUrl}/api/v1/events/${params.eventId}/tournaments`).then(
        (res) => res.json() as Promise<Tournament[]>,
      ),
    ])
      .then(([leagueRows, tournamentRows]) => {
        setLeagues(leagueRows);
        setTournaments(tournamentRows);
        setLeagueId(leagueRows[0]?.id ?? '');
        setTournamentId(tournamentRows[0]?.id ?? '');
      })
      .catch(() => setMessage(t('admin.leagues.loadError')));
  }, [params.eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = () => {
    setMessage(null);
    fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/tournaments/${tournamentId}/request`, {
      method: 'POST',
      credentials: 'include',
    })
      .then((res) => {
        if (!res.ok) throw new Error(t('admin.leagues.requestError'));
        setMessage(t('admin.leagues.requestSent'));
      })
      .catch(() => setMessage(t('admin.leagues.requestError')));
  };

  return (
    <main className="p-8">
      <div className="mb-7">
        <h1 className="text-2xl font-bold">{t('admin.leagues.requestAttach')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('admin.leagues.attachDescription')}</p>
      </div>

      <section className="max-w-xl border border-gray-200 rounded-lg p-5">
        <label className="block text-sm font-medium mb-2" htmlFor="league">
          {t('admin.leagues.league')}
        </label>
        <select
          id="league"
          className="border rounded px-3 py-2 text-sm w-full mb-4"
          value={leagueId}
          onChange={(event) => setLeagueId(event.target.value)}
        >
          {leagues.map((league) => (
            <option key={league.id} value={league.id}>
              {league.name}
            </option>
          ))}
        </select>

        <label className="block text-sm font-medium mb-2" htmlFor="tournament">
          {t('admin.leagues.tournament')}
        </label>
        <select
          id="tournament"
          className="border rounded px-3 py-2 text-sm w-full mb-4"
          value={tournamentId}
          onChange={(event) => setTournamentId(event.target.value)}
        >
          {tournaments.map((tournament) => (
            <option key={tournament.id} value={tournament.id}>
              {tournament.name}
            </option>
          ))}
        </select>

        <button className="bg-gray-950 text-white rounded px-4 py-2 text-sm" onClick={submit}>
          {t('admin.leagues.submitRequest')}
        </button>
        {message && <p className="text-sm text-gray-600 mt-4">{message}</p>}
      </section>
    </main>
  );
}
