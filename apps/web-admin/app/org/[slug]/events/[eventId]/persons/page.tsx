'use client';

/**
 * Persons roster — T-703
 * Route: /org/[slug]/events/[eventId]/persons
 *
 * AC:
 *   ✓ Persons list with search, filter (claim_status), bulk actions
 *   ✓ Manual person creation form
 *   ✓ CSV import wizard link
 *   ✓ Edit person modal
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Person {
  id: string;
  givenName: string;
  familyName: string;
  email: string;
  clubLabel: string | null;
  claimStatus: 'unclaimed' | 'guest_active' | 'claimed';
  hemaRatingsId: string | null;
}

type ClaimFilter = 'all' | 'unclaimed' | 'guest_active' | 'claimed';

const CLAIM_COLORS: Record<string, string> = {
  unclaimed: 'bg-gray-100 text-gray-500',
  guest_active: 'bg-yellow-100 text-yellow-700',
  claimed: 'bg-green-100 text-green-700',
};

// ── Create/Edit form state ────────────────────────────────────────────────────

interface PersonForm {
  givenName: string;
  familyName: string;
  email: string;
  club: string;
  hemaRatingsId: string;
}

const EMPTY_FORM: PersonForm = {
  givenName: '',
  familyName: '',
  email: '',
  club: '',
  hemaRatingsId: '',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function PersonsPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [persons, setPersons] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [claimFilter, setClaimFilter] = useState<ClaimFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = useState(0);

  // Modal state
  const [showCreate, setShowCreate] = useState(false);
  const [editPerson, setEditPerson] = useState<Person | null>(null);
  const [form, setForm] = useState<PersonForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSaving, setFormSaving] = useState(false);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // ── Fetch persons ────────────────────────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();

    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (claimFilter !== 'all') params.set('claimStatus', claimFilter);

    fetch(`${apiUrl}/api/v1/events/${eventId}/persons?${params}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        setLoading(false);
        if (!res.ok) return;
        setPersons((await res.json()) as Person[]);
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (err instanceof Error && err.name === 'AbortError') return;
      });

    return () => controller.abort();
  }, [eventId, apiUrl, search, claimFilter, refreshKey]);

  // ── Create / Edit ────────────────────────────────────────────────────────────

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setEditPerson(null);
    setShowCreate(true);
  }

  function openEdit(p: Person) {
    setForm({
      givenName: p.givenName,
      familyName: p.familyName,
      email: p.email,
      club: p.clubLabel ?? '',
      hemaRatingsId: p.hemaRatingsId ?? '',
    });
    setFormError(null);
    setEditPerson(p);
    setShowCreate(true);
  }

  async function handleSave() {
    if (!form.givenName.trim() || !form.familyName.trim() || !form.email.trim()) {
      setFormError('Given name, family name, and email are required');
      return;
    }
    setFormSaving(true);
    setFormError(null);

    try {
      const url = editPerson
        ? `${apiUrl}/api/v1/persons/${editPerson.id}`
        : `${apiUrl}/api/v1/events/${eventId}/persons`;
      const method = editPerson ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          givenName: form.givenName.trim(),
          familyName: form.familyName.trim(),
          email: form.email.trim(),
          clubName: form.club.trim() || null,
          hemaRatingsId: form.hemaRatingsId.trim() || null,
        }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? 'Save failed');
      }

      setShowCreate(false);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setFormSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────────

  async function handleDelete(personId: string) {
    if (!confirm('Delete this person? This cannot be undone if they have registrations.')) return;
    await fetch(`${apiUrl}/api/v1/persons/${personId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    refresh();
  }

  // ── Bulk check-in ─────────────────────────────────────────────────────────────

  async function handleBulkCheckIn() {
    if (selected.size === 0) return;
    if (!confirm(`Check in ${selected.size} person(s)?`)) return;

    await Promise.all(
      Array.from(selected).map((personId) =>
        fetch(`${apiUrl}/api/v1/events/${eventId}/persons/${personId}/check-in`, {
          method: 'POST',
          credentials: 'include',
        }),
      ),
    );
    setSelected(new Set());
    refresh();
  }

  // ── Selection ─────────────────────────────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === persons.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(persons.map((p) => p.id)));
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

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
            <span className="text-gray-900 font-medium">Persons</span>
          </div>
          <h1 className="text-2xl font-bold">Persons roster</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/org/${slug}/events/${eventId}/persons/import`}
            className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            CSV import
          </Link>
          <button
            onClick={openCreate}
            className="bg-red-700 hover:bg-red-800 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors"
          >
            + Add person
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          type="search"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 w-56"
        />
        <select
          value={claimFilter}
          onChange={(e) => setClaimFilter(e.target.value as ClaimFilter)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
        >
          <option value="all">All statuses</option>
          <option value="unclaimed">Unclaimed</option>
          <option value="guest_active">Guest active</option>
          <option value="claimed">Claimed</option>
        </select>

        {/* Bulk actions */}
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
      ) : persons.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-400 text-sm">No persons found. Add manually or import CSV.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2 pr-3 w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === persons.length && persons.length > 0}
                    onChange={toggleAll}
                    className="rounded"
                  />
                </th>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Club</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">HEMA Ratings</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {persons.map((p) => (
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
                    <p className="text-xs text-gray-400 font-mono">{p.email}</p>
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
                  <td className="py-2 pr-4 text-gray-500 text-xs font-mono">
                    {p.hemaRatingsId ?? '—'}
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
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-4">{editPerson ? 'Edit person' : 'Add person'}</h2>

            {editPerson?.claimStatus !== 'unclaimed' && editPerson && (
              <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 rounded-lg px-3 py-2 text-xs mb-4">
                ⚠ This person has a {editPerson.claimStatus.replace('_', ' ')} session. Changing
                their email will affect their login.
              </div>
            )}

            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Given name *
                  </label>
                  <input
                    type="text"
                    value={form.givenName}
                    onChange={(e) => setForm((f) => ({ ...f, givenName: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Family name *
                  </label>
                  <input
                    type="text"
                    value={form.familyName}
                    onChange={(e) => setForm((f) => ({ ...f, familyName: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Club</label>
                <input
                  type="text"
                  value={form.club}
                  onChange={(e) => setForm((f) => ({ ...f, club: e.target.value }))}
                  placeholder="Lyon AMHE"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  HEMA Ratings ID
                </label>
                <input
                  type="text"
                  value={form.hemaRatingsId}
                  onChange={(e) => setForm((f) => ({ ...f, hemaRatingsId: e.target.value }))}
                  placeholder="hr-12345"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
            </div>

            {formError && (
              <p className="text-sm text-red-600 mt-3" role="alert">
                {formError}
              </p>
            )}

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowCreate(false)}
                className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={formSaving}
                className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
              >
                {formSaving ? 'Saving…' : editPerson ? 'Save changes' : 'Add person'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
