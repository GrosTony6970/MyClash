'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface LiceAssignment {
  liceId: string;
  liceName: string;
  eventName: string;
  tournamentName: string;
  currentMatchId: string | null;
}

export default function LicePickerPage() {
  const router = useRouter();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [assignments, setAssignments] = useState<LiceAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        // Check auth first
        const meRes = await fetch(`${apiUrl}/api/v1/me`, { credentials: 'include' });
        const me = (await meRes.json()) as { type: string };
        if (me.type === 'anonymous') {
          router.replace('/login');
          return;
        }

        // Fetch Lice assignments for this scorekeeper
        // TODO T-402+: real endpoint; for now show placeholder
        setAssignments([]);
      } catch {
        setError('Failed to load assignments. Check your connection.');
      } finally {
        setLoading(false);
      }
    })();
  }, [apiUrl, router]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-gray-400">Loading your assignments…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm text-gray-400 hover:text-white underline"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (assignments.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">🏟️</div>
          <h1 className="text-xl font-bold mb-2">No Lice assigned</h1>
          <p className="text-gray-400 text-sm">
            You have no Lice assignments for today. Ask the organizer to assign you to a Lice.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Your Lices</h1>
        <p className="text-gray-400 text-sm mt-1">Select a Lice to start scoring</p>
      </header>

      <div className="grid gap-4 max-w-lg">
        {assignments.map((a) => (
          <button
            key={a.liceId}
            onClick={() => router.push(`/lices/${a.liceId}`)}
            className="bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl p-5 text-left transition-colors"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">{a.liceName}</h2>
                <p className="text-gray-400 text-sm">
                  {a.tournamentName} · {a.eventName}
                </p>
              </div>
              {a.currentMatchId ? (
                <span className="bg-red-700 text-white text-xs font-bold px-2 py-1 rounded-full animate-pulse">
                  LIVE
                </span>
              ) : (
                <span className="text-gray-500 text-sm">→</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </main>
  );
}
