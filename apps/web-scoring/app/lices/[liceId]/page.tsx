'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface MatchInfo {
  id: string;
  matchNumberLabel: string;
  status: string;
  rulesetCode: string;
  rulesetVersion: string;
  redRegistrationId: string;
  blueRegistrationId: string;
  redScore: number;
  blueScore: number;
  redFighterName?: string;
  blueFighterName?: string;
  weapon?: string;
}

interface Props {
  params: Promise<{ liceId: string }>;
}

export default function LiceMatchPage({ params }: Props) {
  const router = useRouter();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [liceId, setLiceId] = useState<string | null>(null);
  const [currentMatch, setCurrentMatch] = useState<MatchInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [networkStatus, setNetworkStatus] = useState<'online' | 'offline'>('online');

  // Resolve params
  useEffect(() => {
    void params.then(({ liceId: id }) => setLiceId(id));
  }, [params]);

  // Network status monitoring
  useEffect(() => {
    const handleOnline = () => setNetworkStatus('online');
    const handleOffline = () => setNetworkStatus('offline');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setNetworkStatus(navigator.onLine ? 'online' : 'offline');
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Fetch current match for this Lice
  useEffect(() => {
    if (!liceId) return;
    void (async () => {
      try {
        // TODO T-402+: real endpoint for current match on a Lice
        // For now, show placeholder
        setCurrentMatch(null);
      } catch {
        // Offline — show last cached state
      } finally {
        setLoading(false);
      }
    })();
  }, [liceId, apiUrl]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-gray-400">Loading match…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col">
      {/* Network status bar */}
      <div className={`px-4 py-1 text-xs font-bold text-center ${
        networkStatus === 'online'
          ? 'bg-green-900 text-green-300'
          : 'bg-red-900 text-red-300 animate-pulse'
      }`}>
        {networkStatus === 'online' ? '● ONLINE' : '● OFFLINE — exchanges queued locally'}
      </div>

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <button
          onClick={() => router.push('/lices')}
          className="text-gray-400 hover:text-white text-sm"
        >
          ← Lices
        </button>
        <h1 className="font-bold text-lg">Lice {liceId}</h1>
        <div className="w-16" />
      </header>

      {/* Match content */}
      {currentMatch ? (
        <MatchView match={currentMatch} />
      ) : (
        <NoMatchView />
      )}
    </main>
  );
}

// ── Match view ────────────────────────────────────────────────────────────────

function MatchView({ match }: { match: MatchInfo }) {
  return (
    <div className="flex-1 flex flex-col p-6 gap-6">
      {/* Match header */}
      <div className="text-center">
        <p className="text-gray-400 text-sm">{match.matchNumberLabel}</p>
        <p className="text-xs text-gray-500 mt-0.5">
          {match.rulesetCode} v{match.rulesetVersion}
          {match.weapon ? ` · ${match.weapon}` : ''}
        </p>
      </div>

      {/* Scoreboard */}
      <div className="grid grid-cols-3 gap-4 items-center">
        {/* Red fighter */}
        <div className="text-center">
          <div className="bg-red-900 border-2 border-red-600 rounded-xl p-4">
            <p className="text-xs text-red-300 font-bold uppercase tracking-wide mb-1">Rouge</p>
            <p className="font-bold text-lg leading-tight">
              {match.redFighterName ?? 'Fighter A'}
            </p>
          </div>
          <div className="mt-3 text-5xl font-black text-red-400">{match.redScore}</div>
        </div>

        {/* VS */}
        <div className="text-center">
          <p className="text-gray-500 text-2xl font-bold">VS</p>
          <p className="text-xs text-gray-600 mt-1 uppercase tracking-widest">
            {match.status}
          </p>
        </div>

        {/* Blue fighter */}
        <div className="text-center">
          <div className="bg-blue-900 border-2 border-blue-600 rounded-xl p-4">
            <p className="text-xs text-blue-300 font-bold uppercase tracking-wide mb-1">Bleu</p>
            <p className="font-bold text-lg leading-tight">
              {match.blueFighterName ?? 'Fighter B'}
            </p>
          </div>
          <div className="mt-3 text-5xl font-black text-blue-400">{match.blueScore}</div>
        </div>
      </div>

      {/* Exchange pad placeholder — T-403 */}
      <div className="flex-1 flex items-center justify-center border-2 border-dashed border-gray-700 rounded-xl">
        <p className="text-gray-500 text-sm text-center">
          Exchange entry pad<br />
          <span className="text-xs text-gray-600">(T-403)</span>
        </p>
      </div>
    </div>
  );
}

function NoMatchView() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="text-5xl mb-4">⏳</div>
      <h2 className="text-xl font-bold mb-2">No match in progress</h2>
      <p className="text-gray-400 text-sm">
        Waiting for the organizer to assign a match to this Lice.
      </p>
    </div>
  );
}
