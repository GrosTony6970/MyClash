'use client';

import { t } from '@myclash/i18n';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface ClubRow {
  id: string;
  slug: string;
  name: string;
  abbreviation: string | null;
  city: string | null;
  country_code: string | null;
  unverified: string | null;
}

interface EditState {
  name: string;
  abbreviation: string;
  city: string;
  country_code: string;
}

export default function AdminClubsPage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [query, setQuery] = useState('');
  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({
    name: '',
    abbreviation: '',
    city: '',
    country_code: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchClubs = useCallback(
    async (q: string, signal?: AbortSignal) => {
      const params = new URLSearchParams();
      if (q.trim()) {
        params.set('q', q.trim());
        params.set('searchAbv', 'true');
      }
      const res = await fetch(`${apiUrl}/api/v1/clubs?${params.toString()}`, {
        credentials: 'include',
        signal,
      });
      if (!res.ok) throw new Error(t('admin.clubs.loadError'));
      return (await res.json()) as ClubRow[];
    },
    [apiUrl],
  );

  useEffect(() => {
    const controller = new AbortController();

    fetchClubs('', controller.signal)
      .then((data) => {
        setClubs(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : t('common.error'));
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [fetchClubs]);

  async function search(q: string) {
    setLoading(true);
    setError(null);
    try {
      setClubs(await fetchClubs(q));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  }

  function startEdit(club: ClubRow) {
    setEditingId(club.id);
    setEditState({
      name: club.name,
      abbreviation: club.abbreviation ?? '',
      city: club.city ?? '',
      country_code: club.country_code ?? '',
    });
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: string) {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, string | undefined> = {
        name: editState.name.trim() || undefined,
        abbreviation: editState.abbreviation.trim() || undefined,
        city: editState.city.trim() || undefined,
        countryCode: editState.country_code.trim().toUpperCase() || undefined,
      };

      const res = await fetch(`${apiUrl}/api/v1/clubs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? 'Save failed');
      }

      const updated = (await res.json()) as ClubRow;
      setClubs((prev) => prev.map((c) => (c.id === id ? updated : c)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="p-8">
      <div className="mb-2">
        <Link href="/admin" className="text-sm text-gray-500 hover:underline">
          {t('admin.clubs.backToAdmin')}
        </Link>
      </div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('admin.clubs.title')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('admin.clubs.description')}</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Search */}
      <div className="flex gap-2 mb-6">
        <input
          id="admin-clubs-search"
          aria-label={t('admin.clubs.searchLabel')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search(query);
          }}
          placeholder={t('admin.clubs.searchPlaceholder')}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 w-72"
        />
        <button
          onClick={() => void search(query)}
          disabled={loading}
          className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-md text-sm"
        >
          {t('actions.search')}
        </button>
        {query && (
          <button
            onClick={() => {
              setQuery('');
              void search('');
            }}
            className="text-sm text-gray-500 hover:text-gray-700 px-2"
          >
            {t('actions.clear')}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-left text-gray-500 text-xs uppercase tracking-wide">
              <th className="py-3 px-4">{t('admin.clubs.name')}</th>
              <th className="py-3 px-4">{t('admin.clubs.abbreviation')}</th>
              <th className="py-3 px-4">{t('admin.clubs.city')}</th>
              <th className="py-3 px-4">{t('admin.clubs.country')}</th>
              <th className="py-3 px-4">{t('admin.clubs.status')}</th>
              <th className="py-3 px-4">{t('admin.clubs.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {clubs.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-gray-400 text-sm">
                  {loading ? t('common.loading') : t('admin.clubs.empty')}
                </td>
              </tr>
            )}
            {clubs.map((club) =>
              editingId === club.id ? (
                <tr key={club.id} className="border-b border-gray-100 bg-amber-50">
                  <td className="py-2 px-4" aria-label={t('admin.clubs.actions')}>
                    <input
                      aria-label={t('admin.clubs.editNameLabel', { club: club.name })}
                      value={editState.name}
                      onChange={(e) => setEditState((s) => ({ ...s, name: e.target.value }))}
                      className="border border-gray-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-red-600"
                    />
                  </td>
                  <td className="py-2 px-4" aria-label={t('admin.clubs.actions')}>
                    <input
                      aria-label={t('admin.clubs.editAbbreviationLabel', { club: club.name })}
                      value={editState.abbreviation}
                      onChange={(e) =>
                        setEditState((s) => ({ ...s, abbreviation: e.target.value }))
                      }
                      placeholder={t('admin.clubs.abbreviationPlaceholder')}
                      maxLength={20}
                      className="border border-gray-300 rounded px-2 py-1 text-sm w-28 focus:outline-none focus:ring-1 focus:ring-red-600 uppercase"
                    />
                  </td>
                  <td className="py-2 px-4">
                    <input
                      aria-label={t('admin.clubs.editCityLabel', { club: club.name })}
                      value={editState.city}
                      onChange={(e) => setEditState((s) => ({ ...s, city: e.target.value }))}
                      className="border border-gray-300 rounded px-2 py-1 text-sm w-32 focus:outline-none focus:ring-1 focus:ring-red-600"
                    />
                  </td>
                  <td className="py-2 px-4">
                    <input
                      aria-label={t('admin.clubs.editCountryLabel', { club: club.name })}
                      value={editState.country_code}
                      onChange={(e) =>
                        setEditState((s) => ({ ...s, country_code: e.target.value }))
                      }
                      placeholder={t('admin.clubs.countryPlaceholder')}
                      maxLength={2}
                      className="border border-gray-300 rounded px-2 py-1 text-sm w-16 uppercase focus:outline-none focus:ring-1 focus:ring-red-600"
                    />
                  </td>
                  <td className="py-2 px-4">
                    <span className="sr-only">{t('admin.clubs.status')}</span>
                  </td>
                  <td className="py-2 px-4" aria-label={t('admin.clubs.actions')}>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void saveEdit(club.id)}
                        disabled={saving}
                        className="text-xs bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white px-3 py-1 rounded"
                      >
                        {saving ? t('admin.clubs.saving') : t('actions.save')}
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        {t('actions.cancel')}
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={club.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2.5 px-4 font-medium text-gray-900">{club.name}</td>
                  <td className="py-2.5 px-4">
                    {club.abbreviation ? (
                      <span className="font-mono text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded text-xs">
                        {club.abbreviation}
                      </span>
                    ) : (
                      <span className="text-gray-300">{t('common.none')}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-gray-600">{club.city ?? t('common.none')}</td>
                  <td className="py-2.5 px-4 text-gray-600">
                    {club.country_code ?? t('common.none')}
                  </td>
                  <td className="py-2.5 px-4">
                    {club.unverified === 'true' ? (
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                        {t('admin.clubs.unverified')}
                      </span>
                    ) : (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                        {t('admin.clubs.verified')}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-4">
                    <button
                      onClick={() => startEdit(club)}
                      className="text-xs text-red-700 hover:underline"
                    >
                      {t('actions.edit')}
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {clubs.length > 0 && (
        <p className="text-xs text-gray-400 mt-2">
          {t('admin.clubs.count', { count: clubs.length })}
        </p>
      )}
    </main>
  );
}
