'use client';

import { t } from '@myclash/i18n';
import {
  AdminPageHeader,
  BulkActionBar,
  ConfirmDialog,
  RowActionButton,
  SortableHeader,
  fuzzyMatch,
  useSelection,
  useSortableList,
  useToast,
} from '@myclash/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  created_at: string | null;
}

/** Locale-aware short date for the "Added" column. Returns "—" on missing/invalid. */
function formatAddedDate(value: string | null): string {
  if (!value) return '—';
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(ts));
}

type BulkAction = 'verify' | 'unverify' | 'archive' | 'delete' | 'cleanup-delete';

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
  const [showCreateModal, setShowCreateModal] = useState(false);
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

  // Bulk-action selection + dialog state
  const toast = useToast();
  const selection = useSelection();
  const [pendingBulk, setPendingBulk] = useState<BulkAction | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Per-row verify/unverify busy flag (separate from delete busy so the two
  // can't collide when an operator chains operations on the same row).
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  // Bulk-edit modal state — `city` / `country` form fields.
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [bulkEditCity, setBulkEditCity] = useState('');
  const [bulkEditCountry, setBulkEditCountry] = useState('');

  const fetchClubs = useCallback(
    async (q: string, signal?: AbortSignal) => {
      // We deliberately load every club once on mount and filter client-side
      // (see the live fuzzy filter below). When `q` is provided the server
      // still does a server-side narrow — used by the review-request link
      // search, which needs broader matches than the on-page filter.
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

  const refreshClubs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setClubs(await fetchClubs(''));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [fetchClubs]);

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

  // ── Live fuzzy filter + locale-aware sort ───────────────────────────────
  // Order matters: filter first (cheap rejection on the haystack), then sort.
  // Selection survives across filters — a row that was selected but is hidden
  // by the current query still counts toward `selection.count` and reappears
  // when the operator clears the search.
  const filteredClubs = useMemo(() => {
    if (!query.trim()) return clubs;
    return clubs.filter((club) =>
      fuzzyMatch(
        query,
        [club.name, club.abbreviation ?? '', club.city ?? '', club.country_code ?? '']
          .filter(Boolean)
          .join(' '),
      ),
    );
  }, [clubs, query]);

  const getClubSortValue = useCallback((row: ClubRow, key: string): unknown => {
    switch (key) {
      case 'name':
        return row.name;
      case 'city':
        return row.city;
      case 'country':
        return row.country_code;
      case 'createdAt':
        return row.created_at;
      default:
        return null;
    }
  }, []);
  const {
    sorted: visibleClubs,
    sortKey,
    direction,
    toggle,
  } = useSortableList(filteredClubs, getClubSortValue);

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

  async function createClub(): Promise<boolean> {
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
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.clubs.createError'));
      return false;
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

  // ── Verify / Unverify (per-row) ───────────────────────────────────────
  async function setClubVerified(club: ClubRow, verified: boolean) {
    setVerifyingId(club.id);
    setError(null);
    try {
      const action = verified ? 'verify' : 'unverify';
      const res = await fetch(`${apiUrl}/api/v1/clubs/${club.id}/${action}`, {
        method: 'PATCH',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? t('admin.clubs.deleteError'));
      }
      const updated = (await res.json()) as ClubRow;
      setClubs((prev) => prev.map((c) => (c.id === club.id ? updated : c)));
      toast.success(
        verified
          ? t('admin.clubs.verifySuccess', { club: club.name })
          : t('admin.clubs.unverifySuccess', { club: club.name }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : t('admin.clubs.deleteError');
      toast.error(message);
    } finally {
      setVerifyingId(null);
    }
  }

  // ── Bulk verify / unverify / archive / safe-delete / cleanup-delete ────
  async function runBulk(action: BulkAction) {
    const ids = Array.from(selection.selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    setError(null);
    try {
      const route = bulkRoute(action);
      const res = await fetch(`${apiUrl}/api/v1/clubs/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? t('admin.clubs.deleteError'));
      }
      const result = (await res.json()) as {
        succeeded: number;
        failed: number;
        errors: { id: string; message: string }[];
      };

      if (result.failed === 0) {
        toast.success(t(bulkSuccessKey(action), { count: String(result.succeeded) }));
      } else {
        toast.warning(
          t('admin.clubs.bulkPartial', {
            succeeded: String(result.succeeded),
            failed: String(result.failed),
          }),
        );
      }
      selection.clear();
      setPendingBulk(null);
      void refreshClubs();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('admin.clubs.deleteError');
      toast.error(message);
    } finally {
      setBulkBusy(false);
    }
  }

  // Apply city / country across the selected clubs via POST /clubs/bulk-update.
  async function runBulkEdit() {
    const ids = Array.from(selection.selected);
    if (ids.length === 0) return;
    const city = bulkEditCity.trim();
    const country = bulkEditCountry.trim();
    if (!city && !country) {
      toast.error(t('admin.clubs.bulkEditNoFields'));
      return;
    }
    setBulkBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/clubs/bulk-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ids,
          city: city || undefined,
          countryCode: country || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? t('admin.clubs.deleteError'));
      }
      const result = (await res.json()) as {
        succeeded: number;
        failed: number;
        errors: { id: string; message: string }[];
      };
      if (result.failed === 0) {
        toast.success(t('admin.clubs.bulkEditSuccess', { count: String(result.succeeded) }));
      } else {
        toast.warning(
          t('admin.clubs.bulkPartial', {
            succeeded: String(result.succeeded),
            failed: String(result.failed),
          }),
        );
      }
      selection.clear();
      setShowBulkEditModal(false);
      setBulkEditCity('');
      setBulkEditCountry('');
      void refreshClubs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('admin.clubs.deleteError'));
    } finally {
      setBulkBusy(false);
    }
  }

  // Modal wrapper around `createClub()` — closes the modal on success;
  // leaves it open on failure so the operator can fix the input and retry.
  async function createClubFromModal() {
    const ok = await createClub();
    if (ok) setShowCreateModal(false);
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
      await refreshClubs();
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
      await refreshClubs();
      setCreateSuccess(t('admin.clubs.requestLinked'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.clubs.reviewError'));
    } finally {
      setReviewingId(null);
    }
  }

  return (
    <main id="main-content" className="mx-auto w-full px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow="Clubs"
        title={t('admin.clubs.title')}
        subtitle={t('admin.clubs.description')}
        actions={
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-900"
          >
            + {t('admin.clubs.create')}
          </button>
        }
      />

      {error && (
        <div className="mb-4 flex flex-col gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void refreshClubs()}
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

      {/* Search — live client-side fuzzy filter across name / abbreviation / city / country */}
      <div className="mb-6 flex items-center gap-2">
        <input
          id="admin-clubs-search"
          aria-label={t('admin.clubs.searchLabel')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('admin.clubs.searchPlaceholder')}
          className="w-72 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/30"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="px-2 text-sm text-slate-500 hover:text-slate-700"
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
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label={t('admin.clubs.selectAll')}
                  checked={
                    visibleClubs.length > 0 && visibleClubs.every((c) => selection.has(c.id))
                  }
                  onChange={() => selection.toggleAll(visibleClubs.map((c) => c.id))}
                  className="h-4 w-4 cursor-pointer rounded border-slate-300 text-red-800 focus:ring-2 focus:ring-red-800/30"
                />
              </th>
              <th className="py-3 px-4 w-20">{t('admin.clubs.logo')}</th>
              <th className="py-3 px-4">
                <SortableHeader
                  label={t('admin.clubs.name')}
                  columnKey="name"
                  currentKey={sortKey}
                  direction={direction}
                  onToggle={toggle}
                  ariaSortAsc={t('admin.common.sortAscLabel')}
                  ariaSortDesc={t('admin.common.sortDescLabel')}
                />
              </th>
              <th className="py-3 px-4">{t('admin.clubs.abbreviation')}</th>
              <th className="py-3 px-4">
                <SortableHeader
                  label={t('admin.clubs.city')}
                  columnKey="city"
                  currentKey={sortKey}
                  direction={direction}
                  onToggle={toggle}
                  ariaSortAsc={t('admin.common.sortAscLabel')}
                  ariaSortDesc={t('admin.common.sortDescLabel')}
                />
              </th>
              <th className="py-3 px-4">
                <SortableHeader
                  label={t('admin.clubs.country')}
                  columnKey="country"
                  currentKey={sortKey}
                  direction={direction}
                  onToggle={toggle}
                  ariaSortAsc={t('admin.common.sortAscLabel')}
                  ariaSortDesc={t('admin.common.sortDescLabel')}
                />
              </th>
              <th className="py-3 px-4">
                <SortableHeader
                  label={t('admin.clubs.createdAt')}
                  columnKey="createdAt"
                  currentKey={sortKey}
                  direction={direction}
                  onToggle={toggle}
                  ariaSortAsc={t('admin.common.sortAscLabel')}
                  ariaSortDesc={t('admin.common.sortDescLabel')}
                />
              </th>
              <th className="py-3 px-4">{t('admin.clubs.status')}</th>
              <th className="py-3 px-4">{t('admin.clubs.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleClubs.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-400 text-sm">
                  {loading ? t('common.loading') : t('admin.clubs.empty')}
                </td>
              </tr>
            )}
            {visibleClubs.map((club) =>
              editingId === club.id ? (
                <tr key={club.id} className="border-b border-slate-100 bg-amber-50">
                  <td className="px-4 py-2" />
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
                  <td className="py-2 px-4 text-xs text-slate-500">
                    {formatAddedDate(club.created_at)}
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
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={t('admin.clubs.selectRow', { club: club.name })}
                      checked={selection.has(club.id)}
                      onChange={() => selection.toggle(club.id)}
                      className="h-4 w-4 cursor-pointer rounded border-slate-300 text-red-800 focus:ring-2 focus:ring-red-800/30"
                    />
                  </td>
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
                  <td className="py-2.5 px-4 text-xs text-slate-500">
                    {formatAddedDate(club.created_at)}
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
                    <div className="flex gap-2">
                      <RowActionButton variant="edit" onClick={() => startEdit(club)}>
                        {t('actions.edit')}
                      </RowActionButton>
                      <RowActionButton
                        variant={club.unverified === 'true' ? 'success' : 'warning'}
                        onClick={() => void setClubVerified(club, club.unverified === 'true')}
                        disabled={verifyingId === club.id}
                      >
                        {club.unverified === 'true'
                          ? t('admin.clubs.verify')
                          : t('admin.clubs.unverify')}
                      </RowActionButton>
                      <RowActionButton
                        variant="neutral"
                        onClick={() => void deleteClub(club, 'safe')}
                        disabled={deletingId === club.id}
                      >
                        {t('admin.clubs.safeDelete')}
                      </RowActionButton>
                      <RowActionButton
                        variant="warning"
                        onClick={() => void deleteClub(club, 'archive')}
                        disabled={deletingId === club.id}
                      >
                        {t('admin.clubs.archive')}
                      </RowActionButton>
                      <RowActionButton
                        variant="danger"
                        onClick={() => void deleteClub(club, 'cleanup')}
                        disabled={deletingId === club.id}
                      >
                        {t('admin.clubs.cleanupDelete')}
                      </RowActionButton>
                    </div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {visibleClubs.length > 0 && (
        <p className="text-xs text-slate-400 mt-2">
          {t('admin.clubs.count', { count: visibleClubs.length })}
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

      <ConfirmDialog
        open={pendingBulk !== null}
        title={pendingBulk ? t(bulkTitleKey(pendingBulk)) : ''}
        description={
          pendingBulk ? t(bulkConfirmKey(pendingBulk), { count: String(selection.count) }) : ''
        }
        confirmLabel={pendingBulk ? t(bulkConfirmButtonKey(pendingBulk)) : ''}
        danger={
          pendingBulk === 'delete' || pendingBulk === 'archive' || pendingBulk === 'cleanup-delete'
        }
        busy={bulkBusy}
        onCancel={() => setPendingBulk(null)}
        onConfirm={() => {
          if (pendingBulk) void runBulk(pendingBulk);
        }}
      />

      {/* Bulk-edit modal — applies city / country across the selected clubs */}
      {showBulkEditModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('admin.clubs.bulkEditTitle', { count: String(selection.count) })}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !bulkBusy) setShowBulkEditModal(false);
          }}
        >
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-2xl">
            <h2 className="font-display text-xl font-medium tracking-tight text-slate-900">
              {t('admin.clubs.bulkEditTitle', { count: String(selection.count) })}
            </h2>
            <p className="mt-2 text-xs text-slate-500">{t('admin.clubs.bulkEditEmptyHint')}</p>
            <label className="mt-4 block text-xs font-medium text-slate-600">
              {t('admin.clubs.bulkEditCityLabel')}
              <input
                value={bulkEditCity}
                onChange={(e) => setBulkEditCity(e.target.value)}
                maxLength={100}
                placeholder={t('admin.clubs.bulkEditEmptyHint')}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/30"
              />
            </label>
            <label className="mt-3 block text-xs font-medium text-slate-600">
              {t('admin.clubs.bulkEditCountryLabel')}
              <input
                value={bulkEditCountry}
                onChange={(e) => setBulkEditCountry(e.target.value)}
                maxLength={100}
                placeholder={t('admin.clubs.bulkEditEmptyHint')}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-800/30"
              />
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => setShowBulkEditModal(false)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                {t('actions.cancel')}
              </button>
              <button
                type="button"
                disabled={bulkBusy || (!bulkEditCity.trim() && !bulkEditCountry.trim())}
                onClick={() => void runBulkEdit()}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-700 disabled:opacity-50"
              >
                {t('admin.clubs.bulkEditConfirm', { count: String(selection.count) })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create-club modal — opens from the +Create CTA in the page header */}
      {showCreateModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('admin.clubs.createTitle')}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !creating) setShowCreateModal(false);
          }}
        >
          <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-medium tracking-tight text-slate-900">
                  {t('admin.clubs.createTitle')}
                </h2>
                <p className="mt-1 text-xs text-slate-500">{t('admin.clubs.createDescription')}</p>
              </div>
              <button
                type="button"
                disabled={creating}
                onClick={() => setShowCreateModal(false)}
                className="text-sm text-slate-500 hover:text-slate-900 disabled:opacity-50"
              >
                {t('actions.close')}
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
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
                <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 md:col-span-2">
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
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={creating}
                onClick={() => setShowCreateModal(false)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                {t('actions.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void createClubFromModal()}
                disabled={creating || !createState.name.trim()}
                className="rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-900 disabled:opacity-50"
              >
                {creating ? t('admin.clubs.creating') : t('admin.clubs.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      <BulkActionBar
        count={selection.count}
        itemLabel={{
          singular: t('admin.clubs.bulkUnitSingular'),
          plural: t('admin.clubs.bulkUnitPlural'),
        }}
        onClear={() => selection.clear()}
      >
        <button
          type="button"
          onClick={() => setPendingBulk('verify')}
          disabled={bulkBusy}
          className="rounded-md bg-green-700 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-green-800 disabled:opacity-50"
        >
          {t('admin.clubs.bulkVerifyAction')}
        </button>
        <button
          type="button"
          onClick={() => setPendingBulk('unverify')}
          disabled={bulkBusy}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          {t('admin.clubs.bulkUnverifyAction')}
        </button>
        <button
          type="button"
          onClick={() => setPendingBulk('archive')}
          disabled={bulkBusy}
          className="rounded-md bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-amber-700 disabled:opacity-50"
        >
          {t('admin.clubs.bulkArchiveAction')}
        </button>
        <button
          type="button"
          onClick={() => setPendingBulk('delete')}
          disabled={bulkBusy}
          className="rounded-md bg-red-800 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-red-900 disabled:opacity-50"
        >
          {t('admin.clubs.bulkDeleteAction')}
        </button>
        <button
          type="button"
          onClick={() => setPendingBulk('cleanup-delete')}
          disabled={bulkBusy}
          className="rounded-md bg-red-950 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-red-900 disabled:opacity-50"
        >
          {t('admin.clubs.bulkCleanupDeleteAction')}
        </button>
        <button
          type="button"
          onClick={() => {
            setBulkEditCity('');
            setBulkEditCountry('');
            setShowBulkEditModal(true);
          }}
          disabled={bulkBusy}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          {t('admin.clubs.bulkEditAction')}
        </button>
      </BulkActionBar>
    </main>
  );
}

function bulkRoute(action: BulkAction): string {
  switch (action) {
    case 'verify':
      return 'bulk-verify';
    case 'unverify':
      return 'bulk-unverify';
    case 'archive':
      return 'bulk-archive';
    case 'delete':
      return 'bulk-delete';
    case 'cleanup-delete':
      return 'bulk-cleanup-delete';
  }
}

function bulkTitleKey(action: BulkAction): string {
  switch (action) {
    case 'verify':
      return 'admin.clubs.bulkVerifyTitle';
    case 'unverify':
      return 'admin.clubs.bulkUnverifyTitle';
    case 'archive':
      return 'admin.clubs.bulkArchiveTitle';
    case 'delete':
      return 'admin.clubs.bulkDeleteTitle';
    case 'cleanup-delete':
      return 'admin.clubs.bulkCleanupDeleteTitle';
  }
}

function bulkConfirmKey(action: BulkAction): string {
  switch (action) {
    case 'verify':
      return 'admin.clubs.bulkVerifyConfirm';
    case 'unverify':
      return 'admin.clubs.bulkUnverifyConfirm';
    case 'archive':
      return 'admin.clubs.bulkArchiveConfirm';
    case 'delete':
      return 'admin.clubs.bulkDeleteConfirm';
    case 'cleanup-delete':
      return 'admin.clubs.bulkCleanupDeleteConfirm';
  }
}

function bulkConfirmButtonKey(action: BulkAction): string {
  switch (action) {
    case 'verify':
      return 'admin.clubs.verify';
    case 'unverify':
      return 'admin.clubs.unverify';
    case 'archive':
      return 'admin.clubs.archive';
    case 'delete':
      return 'admin.clubs.safeDelete';
    case 'cleanup-delete':
      return 'admin.clubs.cleanupDelete';
  }
}

function bulkSuccessKey(action: BulkAction): string {
  switch (action) {
    case 'verify':
      return 'admin.clubs.bulkVerifySuccess';
    case 'unverify':
      return 'admin.clubs.bulkUnverifySuccess';
    case 'archive':
      return 'admin.clubs.bulkArchiveSuccess';
    case 'delete':
      return 'admin.clubs.bulkDeleteSuccess';
    case 'cleanup-delete':
      return 'admin.clubs.bulkCleanupDeleteSuccess';
  }
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
