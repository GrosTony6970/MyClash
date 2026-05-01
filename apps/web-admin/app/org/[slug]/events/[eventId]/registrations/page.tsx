'use client';

/**
 * Registrations management — T-703
 * Route: /org/[slug]/events/[eventId]/registrations
 *
 * AC:
 *   ✓ Per-event registrations: add (pick from roster), remove, set seed, set bib
 *   ✓ Bulk check-in workflow
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Registration {
  id: string;
  personId: string;
  personName: string;
  clubLabel: string | null;
  tournamentName: string;
  tournamentId: string;
  status: string;
  seed: number | null;
  bibNumber: number | null;
}

interface Tournament {
  id: string;
  name: string;
}

interface Person {
  id: string;
  givenName: string;
  familyName: string;
  clubLabel: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  registered: 'bg-blue-100 text-blue-700',
  checked_in: 'bg-green-100 text-green-700',
  done: 'bg-gray-100 text-gray-500',
  withdrawn: 'bg-red-100 text-red-500',
  disqualified: 'bg-red-200 text-red-700',
};

export default function RegistrationsPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTournament, setSelectedTournament] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = useState(0);

  // Add registration modal
  const [showAdd, setShowAdd] = useState(false);
  const [addTournamentId, setAddTournamentId] = useState('');
  const [persons, setPersons] = useState<Person[]>([]);
  const [personSearch, setPersonSearch] = useState('');
  const [addPersonId, setAddPersonId] = useState('');
  const [addSeed, setAddSeed] = useState('');
  const [addBib, setAddBib] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // ── Fetch ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}/registrations`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([regsRes, tourRes]) => {
        setLoading(false);
        if (regsRes.ok) setRegistrations((await regsRes.json()) as Registration[]);
        if (tourRes.ok) {
          const t = (await tourRes.json()) as Tournament[];
          setTournaments(t);
          if (t.length > 0 && !addTournamentId) setAddTournamentId(t[0]!.id);
        }
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (err instanceof Error && err.name === 'AbortError') return;
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, apiUrl, refreshKey]);

  // ── Person search for add modal ───────────────────────────────────────────────

  useEffect(() => {
    if (!showAdd || personSearch.trim().length < 2) {
      const t = setTimeout(() => setPersons([]), 0);
      return () => clearTimeout(t);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(
        `${apiUrl}/api/v1/events/${eventId}/persons/lookup?q=${encodeURIComponent(personSearch)}`,
        { signal: controller.signal },
      )
        .then(async (res) => {
          if (res.ok) setPersons((await res.json()) as Person[]);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [personSearch, showAdd, eventId, apiUrl]);

  // ── Add registration ──────────────────────────────────────────────────────────

  async function handleAdd() {
    if (!addPersonId || !addTournamentId) {
      setAddError('Select a person and tournament');
      return;
    }
    setAddSaving(true);
    setAddError(null);

    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${addTournamentId}/registrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          personId: addPersonId,
          seed: addSeed ? parseInt(addSeed) : undefined,
          bibNumber: addBib ? parseInt(addBib) : undefined,
        }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? 'Failed to register');
      }

      setShowAdd(false);
      setAddPersonId('');
      setPersonSearch('');
      setAddSeed('');
      setAddBib('');
      refresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setAddSaving(false);
    }
  }

  // ── Remove registration ───────────────────────────────────────────────────────

  async function handleRemove(regId: string) {
    if (!confirm('Remove this registration?')) return;
    await fetch(`${apiUrl}/api/v1/registrations/${regId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    refresh();
  }

  // ── Bulk check-in ─────────────────────────────────────────────────────────────

  async function handleBulkCheckIn() {
    if (selected.size === 0) return;
    if (!confirm(`Check in ${selected.size} registration(s)?`)) return;

    await Promise.all(
      Array.from(selected).map((regId) =>
        fetch(`${apiUrl}/api/v1/registrations/${regId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ status: 'checked_in' }),
        }),
      ),
    );
    setSelected(new Set());
    refresh();
  }

  // ── Filter ────────────────────────────────────────────────────────────────────

  const filtered =
    selectedTournament === 'all'
      ? registrations
      : registrations.filter((r) => r.tournamentId === selectedTournament);

  return (
    <main className="p-8 max-w-5xl">
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
            <span className="text-gray-900 font-medium">Registrations</span>
          </div>
          <h1 className="text-2xl font-bold">Registrations</h1>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-red-700 hover:bg-red-800 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors"
        >
          + Register person
        </button>
      </div>

      {/* Filters + bulk */}
      <div className="flex gap-3 mb-4 flex-wrap items-center">
        <select
          value={selectedTournament}
          onChange={(e) => setSelectedTournament(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
        >
          <option value="all">All tournaments</option>
          {tournaments.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        {selected.size > 0 && (
          <button
            onClick={() => void handleBulkCheckIn()}
            className="bg-green-700 hover:bg-green-800 text-white font-medium py-1.5 px-3 rounded-lg text-sm transition-colors"
          >
            Check in {selected.size} selected
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-400 text-sm">No registrations yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2 pr-3 w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={() => {
                      if (selected.size === filtered.length) setSelected(new Set());
                      else setSelected(new Set(filtered.map((r) => r.id)));
                    }}
                    className="rounded"
                  />
                </th>
                <th className="py-2 pr-4 font-medium">Person</th>
                <th className="py-2 pr-4 font-medium">Tournament</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Seed</th>
                <th className="py-2 pr-4 font-medium">Bib</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 pr-3">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(r.id)) next.delete(r.id);
                          else next.add(r.id);
                          return next;
                        });
                      }}
                      className="rounded"
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <p className="font-medium text-gray-900">{r.personName}</p>
                    {r.clubLabel && <p className="text-xs text-gray-400">{r.clubLabel}</p>}
                  </td>
                  <td className="py-2 pr-4 text-gray-600">{r.tournamentName}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={[
                        'text-xs px-2 py-0.5 rounded-full font-medium',
                        STATUS_COLORS[r.status] ?? 'bg-gray-100 text-gray-500',
                      ].join(' ')}
                    >
                      {r.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-gray-600">{r.seed ?? '—'}</td>
                  <td className="py-2 pr-4 text-gray-600">{r.bibNumber ?? '—'}</td>
                  <td className="py-2">
                    <button
                      onClick={() => void handleRemove(r.id)}
                      className="text-xs text-red-500 hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add registration modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-4">Register person</h2>

            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Tournament *</label>
                <select
                  value={addTournamentId}
                  onChange={(e) => setAddTournamentId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                >
                  {tournaments.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Person *</label>
                <input
                  type="search"
                  value={personSearch}
                  onChange={(e) => {
                    setPersonSearch(e.target.value);
                    setAddPersonId('');
                  }}
                  placeholder="Search by name…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
                {persons.length > 0 && !addPersonId && (
                  <div className="border border-gray-200 rounded-lg mt-1 max-h-40 overflow-y-auto">
                    {persons.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setAddPersonId(p.id);
                          setPersonSearch(`${p.givenName} ${p.familyName}`);
                          setPersons([]);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                      >
                        <span className="font-medium">
                          {p.givenName} {p.familyName}
                        </span>
                        {p.clubLabel && (
                          <span className="text-gray-400 ml-2 text-xs">{p.clubLabel}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Seed (optional)
                  </label>
                  <input
                    type="number"
                    value={addSeed}
                    onChange={(e) => setAddSeed(e.target.value)}
                    min="1"
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Bib number (optional)
                  </label>
                  <input
                    type="number"
                    value={addBib}
                    onChange={(e) => setAddBib(e.target.value)}
                    min="1"
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              </div>
            </div>

            {addError && (
              <p className="text-sm text-red-600 mt-3" role="alert">
                {addError}
              </p>
            )}

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => {
                  setShowAdd(false);
                  setAddPersonId('');
                  setPersonSearch('');
                }}
                className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleAdd()}
                disabled={addSaving || !addPersonId}
                className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
              >
                {addSaving ? 'Registering…' : 'Register'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
