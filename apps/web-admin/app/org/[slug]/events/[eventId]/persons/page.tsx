'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Person {
  id: string;
  givenName: string;
  familyName: string;
  email: string | null;
  clubLabel: string | null;
  claimStatus: 'unclaimed' | 'guest_active' | 'claimed';
  hemaRatingsId: string | null;
}

interface Registration {
  id: string;
  personId: string;
  tournamentId: string;
  tournamentName: string;
  status: 'registered' | 'checked_in' | 'done' | 'withdrawn' | 'disqualified';
  seed: number | null;
}

interface Tournament {
  id: string;
  name: string;
}

const CLAIM_COLORS: Record<string, string> = {
  unclaimed: 'bg-gray-100 text-gray-500',
  guest_active: 'bg-yellow-100 text-yellow-700',
  claimed: 'bg-green-100 text-green-700',
};

const REG_STATUS_COLORS: Record<string, string> = {
  registered: 'bg-blue-100 text-blue-700',
  checked_in: 'bg-green-100 text-green-700',
  done: 'bg-gray-100 text-gray-500',
  withdrawn: 'bg-red-100 text-red-500',
  disqualified: 'bg-red-200 text-red-700',
};

export default function ParticipantsPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [persons, setPersons] = useState<Person[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // placeholders for modal state — wired in later tasks
  const [showAdd, setShowAdd] = useState(false);
  const openEdit = (_p: Person) => {
    /* wired in Task 5 */
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}/persons`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/registrations`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([pRes, rRes, tRes]) => {
        setLoading(false);
        if (pRes.ok) setPersons((await pRes.json()) as Person[]);
        if (rRes.ok) setRegistrations((await rRes.json()) as Registration[]);
        if (tRes.ok) setTournaments((await tRes.json()) as Tournament[]);
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (err instanceof Error && err.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [eventId, apiUrl, refreshKey]);

  const registrationsByPersonId = useMemo(() => {
    const map = new Map<string, Registration[]>();
    for (const reg of registrations) {
      const list = map.get(reg.personId) ?? [];
      map.set(reg.personId, [...list, reg]);
    }
    return map;
  }, [registrations]);

  const filteredPersons = useMemo(() => {
    let list = persons;
    if (activeTab !== 'all') {
      const ids = new Set(
        registrations.filter((r) => r.tournamentId === activeTab).map((r) => r.personId),
      );
      list = list.filter((p) => ids.has(p.id));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => `${p.givenName} ${p.familyName}`.toLowerCase().includes(q));
    }
    return list;
  }, [persons, registrations, activeTab, search]);

  async function handleDelete(personId: string) {
    if (!confirm('Delete this person? This also removes all their tournament registrations.'))
      return;
    await fetch(`${apiUrl}/api/v1/persons/${personId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    refresh();
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === filteredPersons.length && filteredPersons.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredPersons.map((p) => p.id)));
    }
  }

  return (
    <main className="p-8 max-w-6xl">
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
            <span className="text-gray-900 font-medium">Participants</span>
          </div>
          <h1 className="text-2xl font-bold">Participants</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/org/${slug}/events/${eventId}/persons/import`}
            className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            CSV import
          </Link>
          <button
            onClick={() => setShowAdd(true)}
            className="bg-red-700 hover:bg-red-800 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors"
          >
            + Add participant
          </button>
        </div>
      </div>

      <div className="mb-4">
        <input
          type="search"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 w-64"
        />
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {(['all', ...tournaments.map((t) => t.id)] as string[]).map((tabId) => {
          const label =
            tabId === 'all'
              ? 'All event'
              : (tournaments.find((t) => t.id === tabId)?.name ?? tabId);
          const active = activeTab === tabId;
          return (
            <button
              key={tabId}
              onClick={() => {
                setActiveTab(tabId);
                setSelected(new Set());
              }}
              className={[
                'px-3 py-1.5 rounded-full text-sm font-medium transition-colors border',
                active
                  ? 'bg-red-700 text-white border-red-700'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400',
              ].join(' ')}
            >
              {label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : filteredPersons.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-400 text-sm">No participants found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2 pr-3 w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === filteredPersons.length && filteredPersons.length > 0}
                    onChange={toggleAll}
                    className="rounded"
                  />
                </th>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Club</th>
                <th className="py-2 pr-4 font-medium">Claim status</th>
                <th className="py-2 pr-4 font-medium">Tournaments</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPersons.map((p) => {
                const regs = registrationsByPersonId.get(p.id) ?? [];
                const displayRegs =
                  activeTab === 'all' ? regs : regs.filter((r) => r.tournamentId === activeTab);
                return (
                  <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        className="rounded"
                      />
                    </td>
                    <td className="py-2 pr-4">
                      <p className="font-medium text-gray-900">
                        {p.givenName} {p.familyName}
                      </p>
                      {p.email && <p className="text-xs text-gray-400 font-mono">{p.email}</p>}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{p.clubLabel ?? '—'}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={[
                          'text-xs px-2 py-0.5 rounded-full font-medium',
                          CLAIM_COLORS[p.claimStatus] ?? '',
                        ].join(' ')}
                      >
                        {p.claimStatus.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      {displayRegs.length === 0 ? (
                        <span className="text-gray-400 text-xs">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {displayRegs.map((r) => (
                            <span
                              key={r.id}
                              className={[
                                'text-xs px-2 py-0.5 rounded-full font-medium',
                                REG_STATUS_COLORS[r.status] ?? '',
                              ].join(' ')}
                              title={r.tournamentName}
                            >
                              {activeTab === 'all' ? r.tournamentName : r.status.replace('_', ' ')}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => openEdit(p)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => void handleDelete(p.id)}
                          className="text-xs text-red-500 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
