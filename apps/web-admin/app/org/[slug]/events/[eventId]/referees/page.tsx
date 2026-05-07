'use client';

/**
 * Referee admin — T-906
 * Route: /org/[slug]/events/[eventId]/referees
 *
 * AC:
 *   ✓ Add/remove referees (search by name)
 *   ✓ Per user: toggle qualification per role, set rating (1-5 stars)
 *   ✓ Bulk operations
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

type Role = 'arbitre_declarant' | 'arbitre_assesseur' | 'arbitre_table';

const ROLES: { id: Role; label: string; short: string }[] = [
  { id: 'arbitre_declarant', label: 'Arbitre déclarant', short: 'Décl.' },
  { id: 'arbitre_assesseur', label: 'Arbitre assesseur', short: 'Assess.' },
  { id: 'arbitre_table', label: 'Arbitre de table', short: 'Table' },
];

interface Qualification {
  id: string;
  role: Role;
  rating: number | null;
}

interface GlobalPersonResult {
  id: string;
  given_name: string;
  family_name: string;
  display_name: string;
}

interface RefereeEntry {
  personId: string;
  personName: string;
  clubLabel: string | null;
  qualifications: Qualification[];
  globalPersonId: string | null;
}

interface PersonResult {
  id: string;
  given_name: string;
  family_name: string;
  club_label: string | null;
}

function StarRating({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => onChange(value === star ? null : star)}
          className={[
            'text-lg leading-none transition-colors',
            (value ?? 0) >= star ? 'text-amber-400' : 'text-gray-300',
          ].join(' ')}
          title={`Rating ${star}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export default function RefereesPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [referees, setReferees] = useState<RefereeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<PersonResult[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [linkingPersonId, setLinkingPersonId] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [globalResults, setGlobalResults] = useState<GlobalPersonResult[]>([]);

  // ── Fetch qualifications ────────────────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventId}/referee-qualifications`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        setLoading(false);
        if (!res.ok) return;
        const data = (await res.json()) as Array<{
          id: string;
          personId: string;
          role: Role;
          rating: number | null;
          persons?: { given_name: string; family_name: string; clubs?: { name: string } | null };
        }>;

        // Group by person
        const byPerson = new Map<string, RefereeEntry>();
        for (const q of data) {
          const existing = byPerson.get(q.personId) ?? {
            personId: q.personId,
            personName: q.persons ? `${q.persons.given_name} ${q.persons.family_name}` : q.personId,
            clubLabel: q.persons?.clubs?.name ?? null,
            qualifications: [],
            globalPersonId: (q as { global_person_id?: string | null }).global_person_id ?? null,
          };
          existing.qualifications.push({ id: q.id, role: q.role, rating: q.rating });
          byPerson.set(q.personId, existing);
        }
        setReferees(Array.from(byPerson.values()));
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (err instanceof Error && err.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [eventId, apiUrl, refreshKey]);

  // ── Person search ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (search.trim().length < 2) {
      const t = setTimeout(() => setSearchResults([]), 0);
      return () => clearTimeout(t);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`${apiUrl}/api/v1/events/${eventId}/persons/lookup?q=${encodeURIComponent(search)}`, {
        signal: controller.signal,
      })
        .then(async (res) => {
          if (res.ok) setSearchResults((await res.json()) as PersonResult[]);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, eventId, apiUrl]);

  // ── Add qualification ───────────────────────────────────────────────────────

  async function addQualification(personId: string, role: Role) {
    setSaving(`${personId}-${role}`);
    await fetch(`${apiUrl}/api/v1/events/${eventId}/referee-qualifications`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ personId, role, rating: null }),
    });
    setSaving(null);
    setRefreshKey((k) => k + 1);
  }

  // ── Update rating ───────────────────────────────────────────────────────────

  async function updateRating(personId: string, role: Role, rating: number | null) {
    setSaving(`${personId}-${role}-rating`);
    await fetch(`${apiUrl}/api/v1/events/${eventId}/referee-qualifications`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ personId, role, rating }),
    });
    setSaving(null);
    setRefreshKey((k) => k + 1);
  }

  // ── Remove qualification ────────────────────────────────────────────────────

  async function removeQualification(qualId: string) {
    await fetch(`${apiUrl}/api/v1/referee-qualifications/${qualId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    setRefreshKey((k) => k + 1);
  }

  // ── Global person search ────────────────────────────────────────────────────

  useEffect(() => {
    if (globalSearch.trim().length < 2) {
      setGlobalResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`${apiUrl}/api/v1/global-persons?q=${encodeURIComponent(globalSearch)}&roles=referee`, {
        signal: controller.signal,
      })
        .then(async (res) => {
          if (res.ok) setGlobalResults((await res.json()) as GlobalPersonResult[]);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [globalSearch, apiUrl]);

  async function linkToGlobalPerson(qualificationId: string, globalPersonId: string) {
    await fetch(`${apiUrl}/api/v1/global-persons/${globalPersonId}/link-referee-qualification`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ qualificationId }),
    });
    setLinkingPersonId(null);
    setGlobalSearch('');
    setGlobalResults([]);
    setRefreshKey((k) => k + 1);
  }

  async function createAndLinkGlobalPerson(ref: RefereeEntry) {
    const [givenName, ...rest] = ref.personName.split(' ');
    const familyName = rest.join(' ') || (givenName ?? '');
    const res = await fetch(`${apiUrl}/api/v1/global-persons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        givenName: givenName ?? ref.personName,
        familyName,
        displayName: ref.personName,
        isReferee: true,
      }),
    });
    if (!res.ok) return;
    const gp = (await res.json()) as { id: string };
    const qualId = ref.qualifications[0]?.id;
    if (qualId) await linkToGlobalPerson(qualId, gp.id);
  }

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
            <span className="text-gray-900 font-medium">Referees</span>
          </div>
          <h1 className="text-2xl font-bold">Referee qualifications</h1>
        </div>
        <Link
          href={`/org/${slug}/events/${eventId}/pools`}
          className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors"
        >
          ← Pools
        </Link>
      </div>

      {/* Add referee search */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6">
        <p className="text-sm font-medium text-gray-700 mb-2">Add referee</p>
        <div className="relative">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search participant by name…"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          {searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
              {searchResults.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {p.given_name} {p.family_name}
                    </p>
                    {p.club_label && <p className="text-xs text-gray-400">{p.club_label}</p>}
                  </div>
                  <div className="flex gap-1">
                    {ROLES.map((role) => (
                      <button
                        key={role.id}
                        onClick={() => {
                          void addQualification(p.id, role.id);
                          setSearch('');
                          setSearchResults([]);
                        }}
                        disabled={saving === `${p.id}-${role.id}`}
                        className="text-xs border border-gray-300 rounded px-2 py-0.5 hover:bg-gray-100 disabled:opacity-50"
                      >
                        + {role.short}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Referee table */}
      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : referees.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-400 text-sm">No referees qualified yet. Search above to add.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2 pr-4 font-medium">Person</th>
                {ROLES.map((r) => (
                  <th key={r.id} className="py-2 px-3 font-medium text-center">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {referees.map((ref) => (
                <tr key={ref.personId} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 pr-4">
                    <p className="font-medium text-gray-900">{ref.personName}</p>
                    {ref.clubLabel && <p className="text-xs text-gray-400">{ref.clubLabel}</p>}
                    {ref.globalPersonId ? (
                      <span className="text-xs text-emerald-600 font-medium">
                        Global profile linked
                      </span>
                    ) : (
                      <div className="mt-1">
                        {linkingPersonId === ref.personId ? (
                          <div className="flex flex-col gap-1">
                            <input
                              autoFocus
                              type="search"
                              value={globalSearch}
                              onChange={(e) => setGlobalSearch(e.target.value)}
                              placeholder="Search global persons…"
                              className="border border-gray-300 rounded px-2 py-1 text-xs w-48 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            />
                            {globalResults.length > 0 && (
                              <div className="bg-white border border-gray-200 rounded shadow text-xs max-h-32 overflow-y-auto">
                                {globalResults.map((gp) => (
                                  <button
                                    key={gp.id}
                                    onClick={() => {
                                      const qualId = ref.qualifications[0]?.id;
                                      if (qualId) void linkToGlobalPerson(qualId, gp.id);
                                    }}
                                    className="block w-full text-left px-2 py-1 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                                  >
                                    {gp.display_name}
                                  </button>
                                ))}
                              </div>
                            )}
                            <div className="flex gap-1">
                              <button
                                onClick={() => void createAndLinkGlobalPerson(ref)}
                                className="text-xs text-amber-600 hover:text-amber-800"
                              >
                                + Create global profile
                              </button>
                              <button
                                onClick={() => {
                                  setLinkingPersonId(null);
                                  setGlobalSearch('');
                                  setGlobalResults([]);
                                }}
                                className="text-xs text-gray-400 hover:text-gray-600"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setLinkingPersonId(ref.personId)}
                            className="text-xs text-amber-600 hover:text-amber-800"
                          >
                            Link global profile
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  {ROLES.map((role) => {
                    const qual = ref.qualifications.find((q) => q.role === role.id);
                    return (
                      <td key={role.id} className="py-3 px-3 text-center">
                        {qual ? (
                          <div className="flex flex-col items-center gap-1">
                            <StarRating
                              value={qual.rating}
                              onChange={(v) => void updateRating(ref.personId, role.id, v)}
                            />
                            <button
                              onClick={() => void removeQualification(qual.id)}
                              className="text-xs text-red-400 hover:text-red-600"
                            >
                              Remove
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => void addQualification(ref.personId, role.id)}
                            disabled={saving === `${ref.personId}-${role.id}`}
                            className="text-xs text-gray-400 hover:text-gray-600 border border-dashed border-gray-300 rounded px-2 py-0.5 disabled:opacity-50"
                          >
                            + Add
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
