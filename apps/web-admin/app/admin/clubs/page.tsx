'use client';

import { t } from '@myclash/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminBackLink } from '../../../src/components/AdminBackLink';

interface ClubRow {
  id: string;
  slug: string;
  name: string;
  abbreviation: string | null;
  city: string | null;
  country_code: string | null;
  logo_url: string | null;
  unverified: string | null;
  archived_at: string | null;
}

interface EditState {
  name: string;
  abbreviation: string;
  city: string;
  country_code: string;
}

interface CreateState extends EditState {
  website: string;
  logoUrl: string;
}

type DeleteMode = 'safe' | 'archive' | 'cleanup';

const emptyCreateState: CreateState = {
  name: '',
  abbreviation: '',
  city: '',
  country_code: '',
  website: '',
  logoUrl: '',
};

const MAX_LOGO_BYTES = 10 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function formatBlockers(blockers: unknown): string | null {
  if (!blockers || typeof blockers !== 'object') return null;
  const entries = Object.entries(blockers as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'number' && value > 0)
    .map(([key, value]) => `${key}: ${value}`);
  return entries.length > 0 ? entries.join(', ') : null;
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
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [createState, setCreateState] = useState<CreateState>(emptyCreateState);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

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
      if (res.status === 429) throw new Error(t('common.tooManyRequests'));
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

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

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

  function updateLogoPreview(file: File | null) {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    if (!file) {
      setLogoFile(null);
      setLogoPreviewUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    previewUrlRef.current = nextUrl;
    setLogoFile(file);
    setLogoPreviewUrl(nextUrl);
  }

  function handleLogoFile(file: File | null) {
    setError(null);
    if (!file) {
      updateLogoPreview(null);
      return;
    }
    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      updateLogoPreview(null);
      setError(t('admin.clubs.logoTypeError'));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      updateLogoPreview(null);
      setError(t('admin.clubs.logoSizeError'));
      return;
    }
    updateLogoPreview(file);
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

  async function createClub() {
    setCreating(true);
    setError(null);
    setCreateSuccess(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/clubs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: createState.name.trim(),
          abbreviation: createState.abbreviation.trim() || undefined,
          city: createState.city.trim() || undefined,
          countryCode: createState.country_code.trim().toUpperCase() || undefined,
          website: createState.website.trim() || undefined,
          logoUrl: createState.logoUrl.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? t('admin.clubs.createError'));
      }

      let created = (await res.json()) as ClubRow;
      if (logoFile) {
        const form = new FormData();
        form.set('file', logoFile);
        const uploadRes = await fetch(`${apiUrl}/api/v1/clubs/${created.id}/logo`, {
          method: 'POST',
          credentials: 'include',
          body: form,
        });
        if (!uploadRes.ok) {
          const data = (await uploadRes.json().catch(() => ({}))) as { message?: string };
          setClubs((prev) => [created, ...prev]);
          setCreateState(emptyCreateState);
          updateLogoPreview(null);
          setCreateSuccess(t('admin.clubs.createSuccess', { club: created.name }));
          throw new Error(data.message ?? t('admin.clubs.logoUploadError'));
        }
        const upload = (await uploadRes.json()) as { url: string };
        created = { ...created, logo_url: upload.url };
      }
      setClubs((prev) => [created, ...prev]);
      setCreateState(emptyCreateState);
      updateLogoPreview(null);
      setCreateSuccess(t('admin.clubs.createSuccess', { club: created.name }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.clubs.createError'));
    } finally {
      setCreating(false);
    }
  }

  async function deleteClub(club: ClubRow, mode: DeleteMode) {
    const confirmKey =
      mode === 'safe'
        ? 'admin.clubs.confirmSafeDelete'
        : mode === 'archive'
          ? 'admin.clubs.confirmArchive'
          : 'admin.clubs.confirmCleanupDelete';

    if (!window.confirm(t(confirmKey, { club: club.name }))) return;

    setDeletingId(club.id);
    setError(null);
    setCreateSuccess(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/clubs/${club.id}?mode=${mode}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          message?: string | string[];
          blockers?: unknown;
        };
        const message = Array.isArray(data.message)
          ? data.message.join(', ')
          : (data.message ?? t('admin.clubs.deleteError'));
        const blockerText = formatBlockers(data.blockers);
        throw new Error(
          blockerText ? `${message}. ${t('admin.clubs.blockers')}: ${blockerText}` : message,
        );
      }

      setClubs((prev) => prev.filter((item) => item.id !== club.id));
      setCreateSuccess(
        mode === 'archive'
          ? t('admin.clubs.archiveSuccess', { club: club.name })
          : mode === 'cleanup'
            ? t('admin.clubs.cleanupSuccess', { club: club.name })
            : t('admin.clubs.deleteSuccess', { club: club.name }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.clubs.deleteError'));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="p-8">
      <div className="mb-2">
        <AdminBackLink>{t('admin.clubs.backToAdmin')}</AdminBackLink>
      </div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('admin.clubs.title')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('admin.clubs.description')}</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex flex-col gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void search(query)}
            className="w-fit rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
          >
            {t('actions.retry')}
          </button>
        </div>
      )}
      {createSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-md px-4 py-3 mb-4 text-sm">
          {createSuccess}
        </div>
      )}

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3">
          <h2 className="text-base font-semibold text-slate-900">{t('admin.clubs.createTitle')}</h2>
          <p className="text-xs text-slate-500">{t('admin.clubs.createDescription')}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-xs font-medium text-slate-600">
            {t('admin.clubs.name')} *
            <input
              value={createState.name}
              onChange={(e) => setCreateState((s) => ({ ...s, name: e.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            {t('admin.clubs.abbreviation')}
            <input
              value={createState.abbreviation}
              onChange={(e) => setCreateState((s) => ({ ...s, abbreviation: e.target.value }))}
              maxLength={20}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            {t('admin.clubs.city')}
            <input
              value={createState.city}
              onChange={(e) => setCreateState((s) => ({ ...s, city: e.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            {t('admin.clubs.country')}
            <input
              value={createState.country_code}
              onChange={(e) => setCreateState((s) => ({ ...s, country_code: e.target.value }))}
              maxLength={2}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            {t('admin.clubs.website')}
            <input
              value={createState.website}
              onChange={(e) => setCreateState((s) => ({ ...s, website: e.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            {t('admin.clubs.logoUrl')}
            <input
              value={createState.logoUrl}
              onChange={(e) => setCreateState((s) => ({ ...s, logoUrl: e.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </label>
          <label className="text-xs font-medium text-slate-600 md:col-span-2">
            {t('admin.clubs.logoUpload')}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => handleLogoFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-red-600"
            />
            <span className="mt-1 block text-[11px] font-normal text-slate-500">
              {t('admin.clubs.logoHelp')}
            </span>
          </label>
          {logoPreviewUrl && (
            <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 md:col-span-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoPreviewUrl}
                alt={t('admin.clubs.logoPreviewAlt')}
                className="h-12 w-12 rounded-md border border-slate-200 bg-white object-contain"
              />
              <button
                type="button"
                onClick={() => handleLogoFile(null)}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900"
              >
                {t('actions.clear')}
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void createClub()}
          disabled={creating || !createState.name.trim()}
          className="mt-4 rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
        >
          {creating ? t('admin.clubs.creating') : t('admin.clubs.create')}
        </button>
      </section>

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
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => startEdit(club)}
                        className="text-xs text-red-700 hover:underline"
                      >
                        {t('actions.edit')}
                      </button>
                      <button
                        onClick={() => void deleteClub(club, 'safe')}
                        disabled={deletingId === club.id}
                        className="text-xs text-slate-600 hover:text-slate-900 disabled:opacity-50"
                      >
                        {t('admin.clubs.safeDelete')}
                      </button>
                      <button
                        onClick={() => void deleteClub(club, 'archive')}
                        disabled={deletingId === club.id}
                        className="text-xs text-amber-700 hover:text-amber-900 disabled:opacity-50"
                      >
                        {t('admin.clubs.archive')}
                      </button>
                      <button
                        onClick={() => void deleteClub(club, 'cleanup')}
                        disabled={deletingId === club.id}
                        className="text-xs text-red-700 hover:text-red-900 disabled:opacity-50"
                      >
                        {t('admin.clubs.cleanupDelete')}
                      </button>
                    </div>
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
