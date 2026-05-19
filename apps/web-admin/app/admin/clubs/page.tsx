'use client';

import { t } from '@myclash/i18n';
import { AdminPageHeader } from '@myclash/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

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

interface ClubReviewRequest {
  id: string;
  status: string;
  review_notes: string | null;
  created_at: string;
  proposed_club: ClubRow | null;
  linked_existing_club: ClubRow | null;
  event: { id: string; name: string; slug: string } | null;
  organization: { id: string; name: string; slug: string } | null;
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
const LIGHTBOX_PREVIEW_SIZE = 256;

function initialsFor(club: { name: string | null; abbreviation: string | null }): string {
  const source = (club.name?.trim() || club.abbreviation?.trim() || '?').toString();
  const parts = source.split(/\s+/u).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]!.charAt(0) + parts[1]!.charAt(0)).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

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
  const [editLogoFile, setEditLogoFile] = useState<File | null>(null);
  const [editLogoPreviewUrl, setEditLogoPreviewUrl] = useState<string | null>(null);
  const [lightboxClub, setLightboxClub] = useState<ClubRow | null>(null);
  const [lightboxBusy, setLightboxBusy] = useState(false);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<ClubReviewRequest[]>([]);
  const [requestLoading, setRequestLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [linkQueryByRequest, setLinkQueryByRequest] = useState<Record<string, string>>({});
  const [linkMatchesByRequest, setLinkMatchesByRequest] = useState<Record<string, ClubRow[]>>({});
  const previewUrlRef = useRef<string | null>(null);
  const editPreviewUrlRef = useRef<string | null>(null);

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

  const fetchRequests = useCallback(
    async (signal?: AbortSignal) => {
      const res = await fetch(`${apiUrl}/api/v1/clubs/review-requests?status=pending`, {
        credentials: 'include',
        signal,
      });
      if (!res.ok) throw new Error(t('admin.clubs.requestsLoadError'));
      return (await res.json()) as ClubReviewRequest[];
    },
    [apiUrl],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchRequests(controller.signal)
      .then((data) => {
        setRequests(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : t('common.error'));
        }
      })
      .finally(() => setRequestLoading(false));
    return () => controller.abort();
  }, [fetchRequests]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      if (editPreviewUrlRef.current) URL.revokeObjectURL(editPreviewUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!lightboxClub) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightboxClub(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxClub]);

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
    updateEditLogoPreview(null);
    setError(null);
  }

  function cancelEdit() {
    updateEditLogoPreview(null);
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

  function updateEditLogoPreview(file: File | null) {
    if (editPreviewUrlRef.current) {
      URL.revokeObjectURL(editPreviewUrlRef.current);
      editPreviewUrlRef.current = null;
    }
    if (!file) {
      setEditLogoFile(null);
      setEditLogoPreviewUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    editPreviewUrlRef.current = nextUrl;
    setEditLogoFile(file);
    setEditLogoPreviewUrl(nextUrl);
  }

  function handleEditLogoFile(file: File | null) {
    setError(null);
    if (!file) {
      updateEditLogoPreview(null);
      return;
    }
    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      updateEditLogoPreview(null);
      setError(t('admin.clubs.logoTypeError'));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      updateEditLogoPreview(null);
      setError(t('admin.clubs.logoSizeError'));
      return;
    }
    updateEditLogoPreview(file);
  }

  async function uploadLogoFor(clubId: string, file: File): Promise<string> {
    const form = new FormData();
    form.set('file', file);
    const res = await fetch(`${apiUrl}/api/v1/clubs/${clubId}/logo`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(data.message ?? t('admin.clubs.logoUpdateError'));
    }
    const upload = (await res.json()) as { url: string };
    return upload.url;
  }

  function applyLogoUrlToClub(clubId: string, logoUrl: string | null) {
    setClubs((prev) => prev.map((c) => (c.id === clubId ? { ...c, logo_url: logoUrl } : c)));
    setLightboxClub((current) =>
      current && current.id === clubId ? { ...current, logo_url: logoUrl } : current,
    );
  }

  async function replaceLogoFromLightbox(club: ClubRow, file: File) {
    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      setError(t('admin.clubs.logoTypeError'));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError(t('admin.clubs.logoSizeError'));
      return;
    }
    setLightboxBusy(true);
    setError(null);
    setCreateSuccess(null);
    try {
      const url = await uploadLogoFor(club.id, file);
      applyLogoUrlToClub(club.id, url);
      setCreateSuccess(t('admin.clubs.logoReplaced'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.clubs.logoUpdateError'));
    } finally {
      setLightboxBusy(false);
    }
  }

  async function removeLogoFromLightbox(club: ClubRow) {
    if (!window.confirm(t('admin.clubs.logoRemoveConfirm', { club: club.name }))) return;
    setLightboxBusy(true);
    setError(null);
    setCreateSuccess(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/clubs/${club.id}/logo`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? t('admin.clubs.logoUpdateError'));
      }
      applyLogoUrlToClub(club.id, null);
      setCreateSuccess(t('admin.clubs.logoRemoved'));
      setLightboxClub(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.clubs.logoUpdateError'));
    } finally {
      setLightboxBusy(false);
    }
  }

  async function saveEdit(id: string) {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, string | undefined> = {
        name: editState.name.trim() || undefined,
        abbreviation: editState.abbreviation.trim() || undefined,
        city: editState.city.trim() || undefined,
        countryCode: editState.country_code.trim() || undefined,
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

      let updated = (await res.json()) as ClubRow;
      if (editLogoFile) {
        try {
          const url = await uploadLogoFor(id, editLogoFile);
          updated = { ...updated, logo_url: url };
        } catch (uploadErr) {
          setClubs((prev) => prev.map((c) => (c.id === id ? updated : c)));
          updateEditLogoPreview(null);
          setEditingId(null);
          throw uploadErr;
        }
      }
      setClubs((prev) => prev.map((c) => (c.id === id ? updated : c)));
      updateEditLogoPreview(null);
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
          countryCode: createState.country_code.trim() || undefined,
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
        try {
          const url = await uploadLogoFor(created.id, logoFile);
          created = { ...created, logo_url: url };
        } catch (uploadErr) {
          setClubs((prev) => [created, ...prev]);
          setCreateState(emptyCreateState);
          updateLogoPreview(null);
          setCreateSuccess(t('admin.clubs.createSuccess', { club: created.name }));
          throw uploadErr;
        }
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

  async function refreshRequests() {
    setRequestLoading(true);
    try {
      setRequests(await fetchRequests());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.clubs.requestsLoadError'));
    } finally {
      setRequestLoading(false);
    }
  }

  async function reviewRequest(id: string, action: 'approve' | 'reject', body?: unknown) {
    setReviewingId(id);
    setError(null);
    setCreateSuccess(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/clubs/review-requests/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: body ? JSON.stringify(body) : JSON.stringify({}),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? t('admin.clubs.reviewError'));
      }
      await refreshRequests();
      await search(query);
      setCreateSuccess(
        action === 'approve' ? t('admin.clubs.requestApproved') : t('admin.clubs.requestRejected'),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.clubs.reviewError'));
    } finally {
      setReviewingId(null);
    }
  }

  async function searchLinkTarget(requestId: string) {
    const value = linkQueryByRequest[requestId]?.trim() ?? '';
    if (!value) return;
    setError(null);
    try {
      const matches = await fetchClubs(value);
      setLinkMatchesByRequest((current) => ({ ...current, [requestId]: matches }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.clubs.loadError'));
    }
  }

  async function linkRequest(requestId: string, existingClubId: string) {
    setReviewingId(requestId);
    setError(null);
    setCreateSuccess(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/clubs/review-requests/${requestId}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ existingClubId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? t('admin.clubs.reviewError'));
      }
      await refreshRequests();
      await search(query);
      setCreateSuccess(t('admin.clubs.requestLinked'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.clubs.reviewError'));
    } finally {
      setReviewingId(null);
    }
  }

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow="Clubs"
        title={t('admin.clubs.title')}
        subtitle={t('admin.clubs.description')}
      />

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
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {t('admin.clubs.requestsTitle')}
            </h2>
            <p className="text-xs text-slate-500">{t('admin.clubs.requestsDescription')}</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshRequests()}
            disabled={requestLoading}
            className="w-fit rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {t('actions.refresh')}
          </button>
        </div>
        {requests.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            {requestLoading ? t('common.loading') : t('admin.clubs.requestsEmpty')}
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map((request) => (
              <div key={request.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {request.proposed_club?.name ?? t('admin.clubs.unknownClub')}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {request.organization?.name ?? t('common.unknown')} -{' '}
                      {request.event?.name ?? t('common.unknown')}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
                      <span>{request.proposed_club?.abbreviation ?? t('common.none')}</span>
                      <span>{request.proposed_club?.city ?? t('common.none')}</span>
                      <span>{request.proposed_club?.country_code ?? t('common.none')}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void reviewRequest(request.id, 'approve')}
                      disabled={reviewingId === request.id}
                      className="rounded-md bg-green-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-800 disabled:opacity-50"
                    >
                      {t('admin.clubs.approveRequest')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void reviewRequest(request.id, 'reject')}
                      disabled={reviewingId === request.id}
                      className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                    >
                      {t('admin.clubs.rejectRequest')}
                    </button>
                  </div>
                </div>
                <div className="mt-4 rounded-md bg-slate-50 p-3">
                  <label className="text-xs font-semibold text-slate-600">
                    {t('admin.clubs.linkSearchLabel')}
                    <div className="mt-1 flex gap-2">
                      <input
                        value={linkQueryByRequest[request.id] ?? ''}
                        onChange={(event) =>
                          setLinkQueryByRequest((current) => ({
                            ...current,
                            [request.id]: event.target.value,
                          }))
                        }
                        placeholder={t('admin.clubs.linkSearchPlaceholder')}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => void searchLinkTarget(request.id)}
                        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        {t('actions.search')}
                      </button>
                    </div>
                  </label>
                  {(linkMatchesByRequest[request.id] ?? []).length > 0 && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {(linkMatchesByRequest[request.id] ?? [])
                        .filter((club) => club.id !== request.proposed_club?.id)
                        .map((club) => (
                          <button
                            key={club.id}
                            type="button"
                            onClick={() => void linkRequest(request.id, club.id)}
                            disabled={reviewingId === request.id}
                            className="rounded-md border border-slate-200 bg-white p-3 text-left text-xs hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50"
                          >
                            <span className="block font-semibold text-slate-900">{club.name}</span>
                            <span className="text-slate-500">
                              {[club.abbreviation, club.city, club.country_code]
                                .filter(Boolean)
                                .join(' - ') || t('common.none')}
                            </span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

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
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/30"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            {t('admin.clubs.abbreviation')}
            <input
              value={createState.abbreviation}
              onChange={(e) => setCreateState((s) => ({ ...s, abbreviation: e.target.value }))}
              maxLength={20}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-red-800/30"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            {t('admin.clubs.city')}
            <input
              value={createState.city}
              onChange={(e) => setCreateState((s) => ({ ...s, city: e.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/30"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            {t('admin.clubs.country')}
            <input
              value={createState.country_code}
              onChange={(e) => setCreateState((s) => ({ ...s, country_code: e.target.value }))}
              maxLength={100}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/30"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            {t('admin.clubs.website')}
            <input
              value={createState.website}
              onChange={(e) => setCreateState((s) => ({ ...s, website: e.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/30"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            {t('admin.clubs.logoUrl')}
            <input
              value={createState.logoUrl}
              onChange={(e) => setCreateState((s) => ({ ...s, logoUrl: e.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/30"
            />
          </label>
          <label className="text-xs font-medium text-slate-600 md:col-span-2">
            {t('admin.clubs.logoUpload')}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => handleLogoFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-red-800/30"
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
          className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/30 w-72"
        />
        <button
          onClick={() => void search(query)}
          disabled={loading}
          className="bg-red-800 hover:bg-red-900 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-md text-sm"
        >
          {t('actions.search')}
        </button>
        {query && (
          <button
            onClick={() => {
              setQuery('');
              void search('');
            }}
            className="text-sm text-slate-500 hover:text-slate-700 px-2"
          >
            {t('actions.clear')}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-500 text-xs uppercase tracking-wide">
              <th className="py-3 px-4 w-20">{t('admin.clubs.logo')}</th>
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
                <td colSpan={7} className="py-8 text-center text-slate-400 text-sm">
                  {loading ? t('common.loading') : t('admin.clubs.empty')}
                </td>
              </tr>
            )}
            {clubs.map((club) =>
              editingId === club.id ? (
                <tr key={club.id} className="border-b border-slate-100 bg-amber-50">
                  <td className="py-2 px-4">
                    <div className="flex items-center gap-2">
                      <LogoButton club={club} onOpen={setLightboxClub} />
                      <label className="text-[11px] font-medium text-slate-600">
                        <span className="block">{t('admin.clubs.logoReplace')}</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={(e) => handleEditLogoFile(e.target.files?.[0] ?? null)}
                          className="mt-1 block w-40 rounded-md border border-slate-300 px-2 py-1 text-[11px] file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-[11px] file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
                        />
                      </label>
                      {editLogoPreviewUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={editLogoPreviewUrl}
                          alt={t('admin.clubs.logoPreviewAlt')}
                          className="h-8 w-8 rounded-md border border-slate-200 bg-white object-contain"
                        />
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-4" aria-label={t('admin.clubs.actions')}>
                    <input
                      aria-label={t('admin.clubs.editNameLabel', { club: club.name })}
                      value={editState.name}
                      onChange={(e) => setEditState((s) => ({ ...s, name: e.target.value }))}
                      className="border border-slate-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-red-800/30"
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
                      className="border border-slate-300 rounded px-2 py-1 text-sm w-28 focus:outline-none focus:ring-1 focus:ring-red-800/30 uppercase"
                    />
                  </td>
                  <td className="py-2 px-4">
                    <input
                      aria-label={t('admin.clubs.editCityLabel', { club: club.name })}
                      value={editState.city}
                      onChange={(e) => setEditState((s) => ({ ...s, city: e.target.value }))}
                      className="border border-slate-300 rounded px-2 py-1 text-sm w-32 focus:outline-none focus:ring-1 focus:ring-red-800/30"
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
                      maxLength={100}
                      className="border border-slate-300 rounded px-2 py-1 text-sm w-32 focus:outline-none focus:ring-1 focus:ring-red-800/30"
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
                        className="text-xs bg-red-800 hover:bg-red-900 disabled:opacity-50 text-white px-3 py-1 rounded"
                      >
                        {saving ? t('admin.clubs.saving') : t('actions.save')}
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="text-xs text-slate-500 hover:text-slate-700"
                      >
                        {t('actions.cancel')}
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={club.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2.5 px-4">
                    <LogoButton club={club} onOpen={setLightboxClub} />
                  </td>
                  <td className="py-2.5 px-4 font-medium text-slate-900">{club.name}</td>
                  <td className="py-2.5 px-4">
                    {club.abbreviation ? (
                      <span className="font-mono text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded text-xs">
                        {club.abbreviation}
                      </span>
                    ) : (
                      <span className="text-slate-300">{t('common.none')}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-slate-600">{club.city ?? t('common.none')}</td>
                  <td className="py-2.5 px-4 text-slate-600">
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
        <p className="text-xs text-slate-400 mt-2">
          {t('admin.clubs.count', { count: clubs.length })}
        </p>
      )}

      {lightboxClub && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          onClick={() => {
            if (!lightboxBusy) setLightboxClub(null);
          }}
          role="dialog"
          aria-modal="true"
          aria-label={t('admin.clubs.logoLightboxTitle', { club: lightboxClub.name })}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900">
                {t('admin.clubs.logoLightboxTitle', { club: lightboxClub.name })}
              </h2>
              <button
                type="button"
                onClick={() => setLightboxClub(null)}
                disabled={lightboxBusy}
                className="text-sm text-slate-500 hover:text-slate-900 disabled:opacity-50"
              >
                {t('actions.close')}
              </button>
            </div>
            <div className="mb-5 flex items-center justify-center rounded-md border border-slate-200 bg-slate-50 p-4">
              {lightboxClub.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={lightboxClub.logo_url}
                  alt={lightboxClub.name}
                  style={{
                    maxWidth: LIGHTBOX_PREVIEW_SIZE,
                    maxHeight: LIGHTBOX_PREVIEW_SIZE,
                  }}
                  className="rounded-md bg-white object-contain"
                />
              ) : (
                <div
                  style={{ width: LIGHTBOX_PREVIEW_SIZE, height: LIGHTBOX_PREVIEW_SIZE }}
                  className="flex items-center justify-center rounded-full bg-slate-200 text-3xl font-semibold text-slate-500"
                  aria-label={t('admin.clubs.logoInitialsAlt', { club: lightboxClub.name })}
                >
                  {initialsFor(lightboxClub)}
                </div>
              )}
            </div>
            <label className="block text-xs font-medium text-slate-600">
              {lightboxClub.logo_url
                ? t('admin.clubs.logoReplace')
                : t('admin.clubs.logoUploadAction')}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={lightboxBusy}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  if (file && lightboxClub) void replaceLogoFromLightbox(lightboxClub, file);
                  e.target.value = '';
                }}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200 disabled:opacity-50"
              />
              <span className="mt-1 block text-[11px] text-slate-500">
                {t('admin.clubs.logoHelp')}
              </span>
            </label>
            {lightboxClub.logo_url && (
              <button
                type="button"
                onClick={() => void removeLogoFromLightbox(lightboxClub)}
                disabled={lightboxBusy}
                className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                {t('admin.clubs.logoRemove')}
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function LogoButton({ club, onOpen }: { club: ClubRow; onOpen: (club: ClubRow) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(club)}
      className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-white transition hover:border-slate-400 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-red-800/30"
      aria-label={
        club.logo_url
          ? t('admin.clubs.logoLightboxTitle', { club: club.name })
          : t('admin.clubs.logoInitialsAlt', { club: club.name })
      }
    >
      {club.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={club.logo_url} alt={club.name} className="h-full w-full object-contain" />
      ) : (
        <span className="text-[11px] font-semibold text-slate-500">{initialsFor(club)}</span>
      )}
    </button>
  );
}
