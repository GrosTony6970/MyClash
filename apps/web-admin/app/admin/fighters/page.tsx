'use client';

/* eslint-disable myclash/no-literal-string */

import { t } from '@myclash/i18n';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface FighterRow {
  id: string;
  slug: string;
  display_name: string;
  given_name: string;
  family_name: string;
  club_id: string | null;
  country_code: string | null;
  hema_ratings_id: string | null;
  photo_url: string | null;
  bio: string | null;
  gender_category: string | null;
  is_fighter?: boolean;
  is_referee?: boolean;
  is_workshop_participant?: boolean;
  merged_into_id?: string | null;
  deleted_at?: string | null;
  clubs?: {
    id?: string;
    name: string;
    slug?: string;
    abbreviation?: string | null;
    city?: string | null;
    country_code?: string | null;
  } | null;
}

interface MergeAuditEntry {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_id: string;
  created_at: string;
  payload_json: {
    source?: { id?: string; display_name?: string; slug?: string };
    target?: { id?: string; display_name?: string; slug?: string };
    reason?: string | null;
    moved?: {
      personIds?: string[];
      registrationIds?: string[];
      workshopInstructorIds?: string[];
    };
  };
}

interface ClubSearchResult {
  id: string;
  name: string;
  abbreviation: string | null;
  city?: string | null;
  country_code?: string | null;
}

interface ProfileForm {
  givenName: string;
  familyName: string;
  displayName: string;
  hemaRatingsId: string;
  clubQuery: string;
  clubId: string;
  clubName: string;
  clubAbbreviation: string;
  clubCity: string;
  isFighter: boolean;
  isReferee: boolean;
  isWorkshopParticipant: boolean;
}

const emptyProfileForm: ProfileForm = {
  givenName: '',
  familyName: '',
  displayName: '',
  hemaRatingsId: '',
  clubQuery: '',
  clubId: '',
  clubName: '',
  clubAbbreviation: '',
  clubCity: '',
  isFighter: true,
  isReferee: false,
  isWorkshopParticipant: false,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function canRevert(createdAt: string, nowMs: number): boolean {
  return nowMs - new Date(createdAt).getTime() <= 30 * 24 * 60 * 60 * 1000;
}

function FighterCard({ label, fighter }: { label: string; fighter: FighterRow | null }) {
  return (
    <section className="border border-gray-200 rounded-lg p-4 min-h-64">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">{label}</p>
      {!fighter ? (
        <p className="text-sm text-gray-400">No fighter selected.</p>
      ) : (
        <div>
          <div className="flex items-start gap-3">
            <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center text-sm font-semibold text-gray-500 overflow-hidden">
              {fighter.photo_url ? 'Photo' : fighter.display_name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h2 className="text-lg font-semibold">{fighter.display_name}</h2>
              <p className="text-xs font-mono text-gray-500">{fighter.id}</p>
              <p className="text-sm text-gray-500 mt-1">{fighter.slug}</p>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 mt-5 text-sm">
            <div>
              <dt className="text-gray-400">Name</dt>
              <dd>
                {fighter.given_name} {fighter.family_name}
              </dd>
            </div>
            <div>
              <dt className="text-gray-400">Country</dt>
              <dd>{fighter.country_code ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-gray-400">HEMA Ratings</dt>
              <dd>{fighter.hema_ratings_id ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-gray-400">Gender category</dt>
              <dd>{fighter.gender_category ?? '-'}</dd>
            </div>
          </dl>
          {fighter.bio && <p className="text-sm text-gray-600 mt-4 line-clamp-4">{fighter.bio}</p>}
        </div>
      )}
    </section>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

type Tab = 'profiles' | 'create' | 'merge';

export default function AdminFightersPage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const [tab, setTab] = useState<Tab>('profiles');

  // ── Global persons list ──────────────────────────────────────────────────────
  const [personQuery, setPersonQuery] = useState('');
  const [persons, setPersons] = useState<FighterRow[]>([]);
  const [personsLoading, setPersonsLoading] = useState(false);

  async function searchPersons(q: string) {
    setPersonsLoading(true);
    const res = await fetch(`${apiUrl}/api/v1/global-persons?q=${encodeURIComponent(q.trim())}`, {
      credentials: 'include',
    });
    setPersonsLoading(false);
    if (res.ok) setPersons((await res.json()) as FighterRow[]);
  }

  useEffect(() => {
    const controller = new AbortController();

    Promise.resolve()
      .then(() => {
        setPersonsLoading(true);
        return fetch(`${apiUrl}/api/v1/global-persons?q=`, {
          credentials: 'include',
          signal: controller.signal,
        });
      })
      .then(async (res) => {
        if (res.ok) setPersons((await res.json()) as FighterRow[]);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setPersons([]);
        }
      })
      .finally(() => setPersonsLoading(false));

    return () => controller.abort();
  }, [apiUrl]);

  // ── Create profile ───────────────────────────────────────────────────────────
  const [form, setForm] = useState<ProfileForm>(emptyProfileForm);
  const [editingProfile, setEditingProfile] = useState<FighterRow | null>(null);
  const [clubResults, setClubResults] = useState<ClubSearchResult[]>([]);
  const [activeClubIndex, setActiveClubIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [creatingClub, setCreatingClub] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  function resetProfileForm() {
    setForm(emptyProfileForm);
    setEditingProfile(null);
    setClubResults([]);
    setActiveClubIndex(0);
  }

  function startEditProfile(profile: FighterRow) {
    setEditingProfile(profile);
    setForm({
      givenName: profile.given_name ?? '',
      familyName: profile.family_name ?? '',
      displayName: profile.display_name ?? '',
      hemaRatingsId: profile.hema_ratings_id ?? '',
      clubQuery: profile.clubs?.name ?? '',
      clubId: profile.club_id ?? '',
      clubName: profile.clubs?.name ?? '',
      clubAbbreviation: profile.clubs?.abbreviation ?? '',
      clubCity: profile.clubs?.city ?? '',
      isFighter: Boolean(profile.is_fighter),
      isReferee: Boolean(profile.is_referee),
      isWorkshopParticipant: Boolean(profile.is_workshop_participant),
    });
    setCreateError(null);
    setCreateSuccess(null);
    setTab('create');
  }

  async function searchClubs(q: string) {
    if (!q.trim()) {
      setClubResults([]);
      return;
    }
    const res = await fetch(
      `${apiUrl}/api/v1/clubs?q=${encodeURIComponent(q.trim())}&searchAbv=true`,
      { credentials: 'include' },
    );
    if (res.ok) {
      setClubResults((await res.json()) as ClubSearchResult[]);
      setActiveClubIndex(0);
    }
  }

  async function createClubFromProfileForm() {
    const name = form.clubQuery.trim();
    if (!name) return;
    setCreatingClub(true);
    setCreateError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/clubs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name,
          abbreviation: form.clubAbbreviation.trim() || undefined,
          city: form.clubCity.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('admin.globalProfiles.clubCreateError'));
      }
      const club = (await res.json()) as ClubSearchResult;
      setForm((f) => ({
        ...f,
        clubId: club.id,
        clubName: club.name,
        clubQuery: club.name,
        clubAbbreviation: club.abbreviation ?? f.clubAbbreviation,
      }));
      setClubResults([]);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : t('admin.globalProfiles.clubCreateError'),
      );
    } finally {
      setCreatingClub(false);
    }
  }

  async function createProfile() {
    setCreating(true);
    setCreateError(null);
    setCreateSuccess(null);
    try {
      if (!form.isFighter && !form.isReferee && !form.isWorkshopParticipant) {
        throw new Error(t('admin.globalProfiles.roleRequired'));
      }
      const displayName =
        form.displayName.trim() || `${form.givenName.trim()} ${form.familyName.trim()}`;
      const res = await fetch(
        `${apiUrl}/api/v1/global-persons${editingProfile ? `/${editingProfile.id}` : ''}`,
        {
          method: editingProfile ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            givenName: form.givenName.trim(),
            familyName: form.familyName.trim(),
            displayName,
            clubId: form.clubId || undefined,
            clubName: form.clubId ? undefined : form.clubQuery.trim() || undefined,
            clubAbbreviation: form.clubId ? undefined : form.clubAbbreviation.trim() || undefined,
            clubCity: form.clubId ? undefined : form.clubCity.trim() || undefined,
            hemaRatingsId: form.hemaRatingsId.trim() || undefined,
            isFighter: form.isFighter,
            isReferee: form.isReferee,
            isWorkshopParticipant: form.isWorkshopParticipant,
          }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(
          body.message ??
            (editingProfile
              ? t('admin.globalProfiles.updateError')
              : t('admin.globalProfiles.createError')),
        );
      }
      setCreateSuccess(
        editingProfile
          ? t('admin.globalProfiles.updateSuccess', { profile: displayName })
          : t('admin.globalProfiles.createSuccess', { profile: displayName }),
      );
      resetProfileForm();
      void searchPersons(personQuery);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t('admin.globalProfiles.saveError'));
    } finally {
      setCreating(false);
    }
  }

  // ── Merge ────────────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [fighters, setFighters] = useState<FighterRow[]>([]);
  const [source, setSource] = useState<FighterRow | null>(null);
  const [target, setTarget] = useState<FighterRow | null>(null);
  const [reason, setReason] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [audits, setAudits] = useState<MergeAuditEntry[]>([]);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [nowMs, setNowMs] = useState<number | null>(null);

  const refreshAudits = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setNowMs(Date.now()), 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/fighters/merge/audit-log`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load merge audit log');
        setAudits((await res.json()) as MergeAuditEntry[]);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setMergeError(err instanceof Error ? err.message : 'Something went wrong');
        }
      });
    return () => controller.abort();
  }, [apiUrl, refreshKey]);

  async function searchFighters() {
    if (!query.trim()) return;
    setLoading(true);
    setMergeError(null);
    const res = await fetch(`${apiUrl}/api/v1/fighters?q=${encodeURIComponent(query.trim())}`, {
      credentials: 'include',
    });
    setLoading(false);
    if (!res.ok) {
      setMergeError('Fighter search failed.');
      return;
    }
    setFighters((await res.json()) as FighterRow[]);
  }

  async function mergeFighters() {
    if (!source || !target) return;
    if (source.id === target.id) {
      setMergeError('Source and target must be different fighters.');
      return;
    }
    if (confirmName !== source.display_name) {
      setMergeError('Typed confirmation must match the source display name.');
      return;
    }

    const res = await fetch(`${apiUrl}/api/v1/fighters/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ sourceId: source.id, targetId: target.id, reason: reason.trim() }),
    });

    if (res.ok) {
      setSource(null);
      setTarget(null);
      setReason('');
      setConfirmName('');
      setFighters([]);
      refreshAudits();
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    setMergeError(body.message ?? 'Merge failed.');
  }

  async function revertMerge(auditId: string) {
    if (!confirm('Revert this fighter merge?')) return;
    const res = await fetch(`${apiUrl}/api/v1/fighters/merge/${auditId}/revert`, {
      method: 'POST',
      credentials: 'include',
    });
    if (res.ok || res.status === 204) {
      refreshAudits();
      return;
    }
    setMergeError('Merge revert failed.');
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <main className="p-8">
      <div className="mb-2">
        <Link href="/admin" className="text-sm text-gray-500 hover:underline">
          Back to admin
        </Link>
      </div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Global Profiles</h1>
          <p className="text-gray-500 text-sm mt-1">
            Manage global fighter, referee, and workshop participant profiles.
          </p>
        </div>
        <Link
          href="/admin/global-persons/import"
          className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 px-4 rounded-lg"
        >
          CSV import
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6 gap-0">
        {(
          [
            { key: 'profiles', label: 'Profiles' },
            { key: 'create', label: 'New profile' },
            { key: 'merge', label: 'Merge' },
          ] as { key: Tab; label: string }[]
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => {
              if (key === 'create') resetProfileForm();
              setTab(key);
            }}
            className={[
              'py-2 px-5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === key
                ? 'border-red-700 text-red-700'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab: Profiles ── */}
      {tab === 'profiles' && (
        <div>
          <div className="flex gap-2 mb-4">
            <input
              value={personQuery}
              onChange={(e) => setPersonQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void searchPersons(personQuery);
              }}
              placeholder="Search by name…"
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 w-72"
            />
            <button
              onClick={() => void searchPersons(personQuery)}
              disabled={personsLoading}
              className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-md text-sm"
            >
              Search
            </button>
          </div>
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left text-gray-500 text-xs uppercase tracking-wide">
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Club</th>
                  <th className="py-3 px-4">Roles</th>
                  <th className="py-3 px-4">Country</th>
                  <th className="py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {persons.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-400 text-sm">
                      {personsLoading ? 'Loading…' : 'No profiles found.'}
                    </td>
                  </tr>
                )}
                {persons.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2.5 px-4">
                      <p className="font-medium text-gray-900">{p.display_name}</p>
                      <p className="text-xs text-gray-400">
                        {p.given_name} {p.family_name}
                      </p>
                    </td>
                    <td className="py-2.5 px-4 text-gray-600 text-sm">
                      {(p.clubs as { name: string } | null)?.name ?? '—'}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex gap-1 flex-wrap">
                        {p.is_fighter && (
                          <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                            fighter
                          </span>
                        )}
                        {p.is_referee && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                            referee
                          </span>
                        )}
                        {p.is_workshop_participant && (
                          <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                            workshop
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-gray-500 text-sm">{p.country_code ?? '—'}</td>
                    <td className="py-2.5 px-4">
                      <button
                        type="button"
                        onClick={() => startEditProfile(p)}
                        className="text-xs font-semibold text-red-700 hover:underline"
                      >
                        {t('actions.edit')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {persons.length > 0 && (
            <p className="text-xs text-gray-400 mt-2">{persons.length} profiles</p>
          )}
        </div>
      )}

      {/* ── Tab: Create profile ── */}
      {tab === 'create' && (
        <div className="max-w-2xl">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">
                {editingProfile
                  ? t('admin.globalProfiles.editTitle')
                  : t('admin.globalProfiles.createTitle')}
              </h2>
              <p className="text-xs text-gray-500 mt-1">{t('admin.globalProfiles.requiredNote')}</p>
            </div>
            {editingProfile && (
              <button
                type="button"
                onClick={resetProfileForm}
                className="text-sm font-semibold text-gray-600 hover:text-gray-900"
              >
                {t('admin.globalProfiles.cancelEdit')}
              </button>
            )}
          </div>
          {createError && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 mb-4 text-sm">
              {createError}
            </div>
          )}
          {createSuccess && (
            <div className="bg-green-50 border border-green-200 text-green-700 rounded-md px-4 py-3 mb-4 text-sm">
              {createSuccess}
            </div>
          )}

          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Given name <span className="text-red-600">*</span>
                </label>
                <input
                  value={form.givenName}
                  onChange={(e) => setForm((f) => ({ ...f, givenName: e.target.value }))}
                  className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Family name <span className="text-red-600">*</span>
                </label>
                <input
                  value={form.familyName}
                  onChange={(e) => setForm((f) => ({ ...f, familyName: e.target.value }))}
                  className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Display name (leave blank to auto-generate)
              </label>
              <input
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                placeholder={
                  form.givenName || form.familyName
                    ? `${form.givenName} ${form.familyName}`.trim()
                    : undefined
                }
                className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {t('admin.globalProfiles.hemaRatingsId')}
              </label>
              <input
                value={form.hemaRatingsId}
                onChange={(e) => setForm((f) => ({ ...f, hemaRatingsId: e.target.value }))}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Club</label>
              <div className="relative">
                <input
                  value={form.clubQuery}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, clubQuery: e.target.value, clubId: '', clubName: '' }));
                    void searchClubs(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (clubResults.length === 0) return;
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setActiveClubIndex((index) => Math.min(index + 1, clubResults.length - 1));
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setActiveClubIndex((index) => Math.max(index - 1, 0));
                    }
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const selected = clubResults[activeClubIndex];
                      if (!selected) return;
                      setForm((f) => ({
                        ...f,
                        clubId: selected.id,
                        clubName: selected.name,
                        clubQuery: selected.name,
                        clubAbbreviation: selected.abbreviation ?? f.clubAbbreviation,
                        clubCity: selected.city ?? f.clubCity,
                      }));
                      setClubResults([]);
                    }
                  }}
                  placeholder="Search clubs by name or abbreviation…"
                  className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-red-600"
                />
                {form.clubId && (
                  <p className="text-xs text-green-700 mt-1">Selected: {form.clubName}</p>
                )}
                {clubResults.length > 0 && !form.clubId && (
                  <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                    {clubResults.map((c, index) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setForm((f) => ({
                            ...f,
                            clubId: c.id,
                            clubName: c.name,
                            clubQuery: c.name,
                            clubAbbreviation: c.abbreviation ?? f.clubAbbreviation,
                            clubCity: c.city ?? f.clubCity,
                          }));
                          setClubResults([]);
                        }}
                        className={[
                          'w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2',
                          index === activeClubIndex ? 'bg-red-50' : '',
                        ].join(' ')}
                      >
                        <span>{c.name}</span>
                        {c.abbreviation && (
                          <span className="text-xs text-gray-400 font-mono">{c.abbreviation}</span>
                        )}
                        {(c.city || c.country_code) && (
                          <span className="text-xs text-gray-400">
                            {[c.city, c.country_code].filter(Boolean).join(', ')}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {!form.clubId && form.clubQuery.trim() && (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <input
                    value={form.clubAbbreviation}
                    onChange={(e) => setForm((f) => ({ ...f, clubAbbreviation: e.target.value }))}
                    placeholder={t('admin.globalProfiles.clubAbbreviation')}
                    className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                  <input
                    value={form.clubCity}
                    onChange={(e) => setForm((f) => ({ ...f, clubCity: e.target.value }))}
                    placeholder={t('admin.globalProfiles.clubCity')}
                    className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                  <button
                    type="button"
                    onClick={() => void createClubFromProfileForm()}
                    disabled={creatingClub}
                    className="rounded-md border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {creatingClub
                      ? t('admin.globalProfiles.creatingClub')
                      : t('admin.globalProfiles.clubCreateFromSearch')}
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Roles</label>
              <div className="flex gap-4">
                {(
                  [
                    { key: 'isFighter', label: 'Fighter' },
                    { key: 'isReferee', label: 'Referee' },
                    { key: 'isWorkshopParticipant', label: 'Workshop' },
                  ] as {
                    key: keyof Pick<
                      ProfileForm,
                      'isFighter' | 'isReferee' | 'isWorkshopParticipant'
                    >;
                    label: string;
                  }[]
                ).map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={form[key] as boolean}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
                      className="accent-red-700"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={() => void createProfile()}
              disabled={
                !form.givenName.trim() ||
                !form.familyName.trim() ||
                (!form.isFighter && !form.isReferee && !form.isWorkshopParticipant) ||
                creating
              }
              className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-6 rounded-lg text-sm self-start"
            >
              {creating
                ? editingProfile
                  ? t('admin.globalProfiles.saving')
                  : t('admin.globalProfiles.creating')
                : editingProfile
                  ? t('admin.globalProfiles.saveProfile')
                  : t('admin.globalProfiles.createProfile')}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab: Merge ── */}
      {tab === 'merge' && (
        <div>
          {mergeError && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 mb-4 text-sm">
              {mergeError}
            </div>
          )}

          <section className="border border-gray-200 rounded-lg p-4 mb-6">
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void searchFighters();
                }}
                placeholder="Search fighters by name"
                className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 w-80"
              />
              <button
                onClick={() => void searchFighters()}
                disabled={loading}
                className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-md text-sm"
              >
                Search
              </button>
            </div>
            {fighters.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-gray-500">
                      <th className="py-2 pr-4">Fighter</th>
                      <th className="py-2 pr-4">HEMA Ratings</th>
                      <th className="py-2">Select</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fighters.map((fighter) => (
                      <tr key={fighter.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 pr-4">
                          <p className="font-medium">{fighter.display_name}</p>
                          <p className="font-mono text-xs text-gray-500">{fighter.id}</p>
                        </td>
                        <td className="py-2 pr-4 text-gray-500">
                          {fighter.hema_ratings_id ?? '-'}
                        </td>
                        <td className="py-2">
                          <div className="flex gap-2">
                            <button
                              onClick={() => setSource(fighter)}
                              className="text-xs text-red-700 hover:underline"
                            >
                              Source
                            </button>
                            <button
                              onClick={() => setTarget(fighter)}
                              className="text-xs text-green-700 hover:underline"
                            >
                              Target
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2 mb-6">
            <FighterCard label="Source: profile to merge away" fighter={source} />
            <FighterCard label="Target: profile to keep" fighter={target} />
          </div>

          <section className="border border-gray-200 rounded-lg p-4 mb-8">
            <h2 className="text-base font-semibold mb-4">Confirm merge</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason"
                className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
              />
              <input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={
                  source ? `Type: ${source.display_name}` : 'Select a source fighter first'
                }
                className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>
            <button
              onClick={() => void mergeFighters()}
              disabled={!source || !target || confirmName !== source?.display_name}
              className="mt-3 bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-md text-sm"
            >
              Merge source into target
            </button>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">Recent merges</h2>
            {audits.length === 0 ? (
              <p className="text-gray-400 text-sm">No fighter merges yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-gray-500">
                      <th className="py-2 pr-4">Merge</th>
                      <th className="py-2 pr-4">Reason</th>
                      <th className="py-2 pr-4">Created</th>
                      <th className="py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audits.map((audit) => (
                      <tr key={audit.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 pr-4">
                          <p>
                            {audit.payload_json.source?.display_name ??
                              audit.payload_json.source?.id ??
                              audit.entity_id}
                            {' -> '}
                            {audit.payload_json.target?.display_name ??
                              audit.payload_json.target?.id ??
                              '-'}
                          </p>
                          <p className="text-xs text-gray-500">
                            Persons {audit.payload_json.moved?.personIds?.length ?? 0},
                            registrations {audit.payload_json.moved?.registrationIds?.length ?? 0},
                            instructors{' '}
                            {audit.payload_json.moved?.workshopInstructorIds?.length ?? 0}
                          </p>
                        </td>
                        <td className="py-2 pr-4 text-gray-600">
                          {audit.payload_json.reason ?? '-'}
                        </td>
                        <td className="py-2 pr-4 text-gray-500">
                          {new Date(audit.created_at).toLocaleDateString('fr-FR')}
                        </td>
                        <td className="py-2">
                          <button
                            onClick={() => void revertMerge(audit.id)}
                            disabled={nowMs === null || !canRevert(audit.created_at, nowMs)}
                            className="text-xs text-red-700 hover:underline disabled:text-gray-300"
                          >
                            Revert
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
