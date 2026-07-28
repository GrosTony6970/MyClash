'use client';

import { t } from '@myclash/i18n';
import { getDateFormat } from '@myclash/types';
import {
  Button,
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  SortableHeader,
  useConfirm,
  useSortableList,
} from '@myclash/ui';
import { localeToBcp47 } from '@myclash/time';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../src/i18n/I18nProvider';
import { getPublicApiUrl } from '@/lib/api-url';

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
  email?: string | null;
  date_of_birth?: string | null;
  photo_url: string | null;
  bio: string | null;
  gender_category: string | null;
  is_fighter?: boolean;
  is_referee?: boolean;
  is_workshop_participant?: boolean;
  is_instructor?: boolean;
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
  email: string;
  /** Locale-formatted DOB (DD/MM/YYYY for fr, MM/DD/YYYY for en).
   *  Converted to/from ISO at the form boundary via getDateFormat. */
  dateOfBirth: string;
  clubQuery: string;
  clubId: string;
  clubName: string;
  clubAbbreviation: string;
  clubCity: string;
  isFighter: boolean;
  isReferee: boolean;
  isWorkshopParticipant: boolean;
  isInstructor: boolean;
}

const emptyProfileForm: ProfileForm = {
  givenName: '',
  familyName: '',
  displayName: '',
  hemaRatingsId: '',
  email: '',
  dateOfBirth: '',
  clubQuery: '',
  clubId: '',
  clubName: '',
  clubAbbreviation: '',
  clubCity: '',
  isFighter: true,
  isReferee: false,
  isWorkshopParticipant: false,
  isInstructor: false,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function canRevert(createdAt: string, nowMs: number): boolean {
  return nowMs - new Date(createdAt).getTime() <= 30 * 24 * 60 * 60 * 1000;
}

function FighterCard({ label, fighter }: { label: string; fighter: FighterRow | null }) {
  return (
    <section className="border border-border rounded-lg p-4 min-h-64">
      <p className="text-xs text-muted uppercase tracking-wide mb-3">{label}</p>
      {!fighter ? (
        <p className="text-sm text-muted">{t('admin.globalProfiles.merge.noFighterSelected')}</p>
      ) : (
        <div>
          <div className="flex items-start gap-3">
            <div className="h-12 w-12 rounded-full bg-background flex items-center justify-center text-sm font-semibold text-muted overflow-hidden">
              {fighter.photo_url
                ? t('admin.globalProfiles.merge.cardPhoto')
                : fighter.display_name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h2 className="font-display font-semibold text-lg sm:text-xl">
                {fighter.display_name}
              </h2>
              <p className="font-mono text-xs text-muted">{fighter.slug}</p>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 mt-5 text-sm">
            <div>
              <dt className="text-muted">{t('admin.globalProfiles.merge.cardName')}</dt>
              <dd>
                {fighter.given_name} {fighter.family_name}
              </dd>
            </div>
            <div>
              <dt className="text-muted">{t('admin.globalProfiles.merge.cardCountry')}</dt>
              <dd>{fighter.country_code ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-muted">{t('admin.globalProfiles.merge.cardHemaRatings')}</dt>
              <dd>{fighter.hema_ratings_id ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-muted">{t('admin.globalProfiles.merge.cardGenderCategory')}</dt>
              <dd>{fighter.gender_category ?? '-'}</dd>
            </div>
          </dl>
          {fighter.bio && (
            <p className="text-sm text-foreground-secondary mt-4 line-clamp-4">{fighter.bio}</p>
          )}
        </div>
      )}
    </section>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  if (res.status === 429) return t('common.tooManyRequests');
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === 'string') {
      // The fighters service translates the partial-unique-index
      // violation on lower(email) into ConflictException('email_in_use').
      // Surface a friendly i18n string rather than the raw code.
      if (res.status === 409 && body.message === 'email_in_use') {
        return t('admin.globalProfiles.errors.emailInUse');
      }
      return body.message;
    }
  } catch {
    // Keep the localized fallback when the API body is empty.
  }
  return fallback;
}

type Tab = 'profiles' | 'create' | 'merge';

export default function AdminFightersPage() {
  const apiUrl = getPublicApiUrl();
  const { locale } = useI18n();
  const dateFormat = useMemo(() => getDateFormat(locale), [locale]);
  const { confirm, confirmDialog } = useConfirm();
  const [tab, setTab] = useState<Tab>('profiles');

  // ── Global persons list ──────────────────────────────────────────────────────
  const [personQuery, setPersonQuery] = useState('');
  const [persons, setPersons] = useState<FighterRow[]>([]);
  const [personsLoading, setPersonsLoading] = useState(false);
  const [personsError, setPersonsError] = useState<string | null>(null);

  async function searchPersons(q: string, signal?: AbortSignal) {
    setPersonsLoading(true);
    setPersonsError(null);
    let res: Response;
    try {
      res = await fetch(`${apiUrl}/api/v1/global-persons?q=${encodeURIComponent(q.trim())}`, {
        credentials: 'include',
        signal,
      });
    } catch (err) {
      // Aborted by a newer keystroke — stay in the loading state of the
      // newer request rather than overwriting it with an error.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setPersonsLoading(false);
      setPersonsError(t('admin.globalProfiles.loadError'));
      return;
    }
    setPersonsLoading(false);
    if (res.ok) {
      setPersons((await res.json()) as FighterRow[]);
      return;
    }
    setPersonsError(await readErrorMessage(res, t('admin.globalProfiles.loadError')));
  }

  // Debounced server-side search: fire `q=...` ~250 ms after each keystroke
  // settles. An AbortController cancels the in-flight request when the
  // operator keeps typing — see searchPersons above.
  useEffect(() => {
    const controller = new AbortController();
    const handle = setTimeout(() => {
      void searchPersons(personQuery, controller.signal);
    }, 250);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchPersons is stable
  }, [personQuery, apiUrl]);

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
      email: profile.email ?? '',
      dateOfBirth: dateFormat.format(profile.date_of_birth ?? ''),
      clubQuery: profile.clubs?.name ?? '',
      clubId: profile.club_id ?? '',
      clubName: profile.clubs?.name ?? '',
      clubAbbreviation: profile.clubs?.abbreviation ?? '',
      clubCity: profile.clubs?.city ?? '',
      isFighter: Boolean(profile.is_fighter),
      isReferee: Boolean(profile.is_referee),
      isWorkshopParticipant: Boolean(profile.is_workshop_participant),
      isInstructor: Boolean(profile.is_instructor),
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
      setCreateError(null);
      return;
    }
    setCreateError(await readErrorMessage(res, t('admin.globalProfiles.clubSearchError')));
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
        throw new Error(await readErrorMessage(res, t('admin.globalProfiles.clubCreateError')));
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
      if (!form.isFighter && !form.isReferee && !form.isWorkshopParticipant && !form.isInstructor) {
        throw new Error(t('admin.globalProfiles.roleRequired'));
      }
      // Convert the locale-formatted DOB to ISO before POST. Empty
      // input is fine (DOB is optional); a non-empty value that
      // fails to parse is a user error caught here so we never POST
      // a malformed date.
      let dateOfBirthIso: string | undefined;
      if (form.dateOfBirth.trim()) {
        const parsed = dateFormat.parse(form.dateOfBirth);
        if (!parsed) {
          throw new Error(t('admin.globalProfiles.errors.dobFormat'));
        }
        dateOfBirthIso = parsed;
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
            email: form.email.trim() || undefined,
            dateOfBirth: dateOfBirthIso,
            isFighter: form.isFighter,
            isReferee: form.isReferee,
            isWorkshopParticipant: form.isWorkshopParticipant,
            isInstructor: form.isInstructor,
          }),
        },
      );
      if (!res.ok) {
        throw new Error(
          await readErrorMessage(
            res,
            editingProfile
              ? t('admin.globalProfiles.updateError')
              : t('admin.globalProfiles.createError'),
          ),
        );
      }
      setCreateSuccess(
        editingProfile
          ? t('admin.globalProfiles.updateSuccess', { profile: displayName })
          : t('admin.globalProfiles.createSuccess', { profile: displayName }),
      );
      resetProfileForm();
      // Return to the Profiles list so the saved row is immediately
      // visible; the success banner is hoisted above the tab content so
      // it survives the tab switch.
      setTab('profiles');
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
        if (!res.ok)
          throw new Error(
            await readErrorMessage(res, t('admin.globalProfiles.merge.auditLoadError')),
          );
        setAudits((await res.json()) as MergeAuditEntry[]);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setMergeError(
            err instanceof Error ? err.message : t('admin.globalProfiles.merge.somethingWrong'),
          );
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
      setMergeError(await readErrorMessage(res, t('admin.globalProfiles.merge.searchFailed')));
      return;
    }
    setFighters((await res.json()) as FighterRow[]);
  }

  async function mergeFighters() {
    if (!source || !target) return;
    if (source.id === target.id) {
      setMergeError(t('admin.globalProfiles.merge.sourceTargetDifferent'));
      return;
    }
    if (confirmName !== source.display_name) {
      setMergeError(t('admin.globalProfiles.merge.confirmMismatch'));
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
    setMergeError(await readErrorMessage(res, t('admin.globalProfiles.merge.mergeFailed')));
  }

  async function revertMerge(auditId: string) {
    if (!(await confirm({ title: t('admin.globalProfiles.merge.revertConfirm'), danger: true })))
      return;
    const res = await fetch(`${apiUrl}/api/v1/fighters/merge/${auditId}/revert`, {
      method: 'POST',
      credentials: 'include',
    });
    if (res.ok || res.status === 204) {
      refreshAudits();
      return;
    }
    setMergeError(await readErrorMessage(res, t('admin.globalProfiles.merge.revertFailed')));
  }

  // ── Sort over the current persons result set ─────────────────────────────
  // Sort runs on whatever the server returned for the active query — i.e. it
  // re-orders the visible page-level result set, not the underlying dataset.
  const getPersonSortValue = useCallback((row: FighterRow, key: string): unknown => {
    switch (key) {
      case 'givenName':
        return row.given_name;
      case 'familyName':
        return row.family_name;
      case 'displayName':
        return row.display_name;
      case 'club':
        return row.clubs?.name ?? '';
      case 'hemaRatingsId':
        return row.hema_ratings_id ?? '';
      default:
        return null;
    }
  }, []);
  const {
    sorted: sortedPersons,
    sortKey: personSortKey,
    direction: personSortDir,
    toggle: togglePersonSort,
  } = useSortableList(persons, getPersonSortValue);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <main className="mx-auto max-w-[110rem] px-6 py-8 lg:px-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl">
            {t('admin.globalProfiles.title')}
          </h1>
          <p className="text-muted text-sm mt-1">{t('admin.globalProfiles.description')}</p>
        </div>
        <Button asChild variant="primary">
          <Link href="/admin/global-persons/import">{t('admin.globalProfiles.csvImport')}</Link>
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border mb-6 gap-0">
        {(
          [
            { key: 'profiles', label: t('admin.globalProfiles.tabs.profiles') },
            { key: 'create', label: t('admin.globalProfiles.tabs.create') },
            { key: 'merge', label: t('admin.globalProfiles.tabs.merge') },
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
                ? 'border-accent text-accent'
                : 'border-transparent text-muted hover:text-foreground-secondary',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {createSuccess && (
        <div className="bg-success/10 border border-success/30 text-success rounded-md px-4 py-3 mb-4 text-sm">
          {createSuccess}
        </div>
      )}

      {/* ── Tab: Profiles ── */}
      {tab === 'profiles' && (
        <div>
          {personsError && (
            <div className="mb-4 flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger sm:flex-row sm:items-center sm:justify-between">
              <span>{personsError}</span>
              <button
                type="button"
                onClick={() => void searchPersons(personQuery)}
                className="w-fit rounded-md border border-danger/30 bg-surface px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10"
              >
                {t('actions.retry')}
              </button>
            </div>
          )}
          {/* Live debounced server-side search — query fires ~250 ms after typing stops. */}
          <div className="mb-4 flex items-center gap-2">
            <input
              value={personQuery}
              onChange={(e) => setPersonQuery(e.target.value)}
              placeholder={t('admin.globalProfiles.searchByName')}
              className="w-72 rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
            {personQuery && (
              <button
                type="button"
                onClick={() => setPersonQuery('')}
                className="px-2 text-sm text-muted hover:text-foreground-secondary"
              >
                {t('actions.clear')}
              </button>
            )}
          </div>
          <DataTable>
            <DataTableHead>
              <DataTableCell as="th">
                <SortableHeader
                  label={t('admin.globalProfiles.colName')}
                  columnKey="displayName"
                  currentKey={personSortKey}
                  direction={personSortDir}
                  onToggle={togglePersonSort}
                  ariaSortAsc={t('admin.common.sortAscLabel')}
                  ariaSortDesc={t('admin.common.sortDescLabel')}
                />
              </DataTableCell>
              <DataTableCell as="th">
                <SortableHeader
                  label={t('admin.globalProfiles.colClub')}
                  columnKey="club"
                  currentKey={personSortKey}
                  direction={personSortDir}
                  onToggle={togglePersonSort}
                  ariaSortAsc={t('admin.common.sortAscLabel')}
                  ariaSortDesc={t('admin.common.sortDescLabel')}
                />
              </DataTableCell>
              <DataTableCell as="th">{t('admin.globalProfiles.colRoles')}</DataTableCell>
              <DataTableCell as="th">{t('admin.globalProfiles.colCountry')}</DataTableCell>
              <DataTableCell as="th">{t('admin.globalProfiles.colActions')}</DataTableCell>
            </DataTableHead>
            <tbody>
              {sortedPersons.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted text-sm">
                    {personsLoading
                      ? t('admin.globalProfiles.loading')
                      : t('admin.globalProfiles.noProfilesFound')}
                  </td>
                </tr>
              )}
              {sortedPersons.map((p) => (
                <DataTableRow key={p.id}>
                  <DataTableCell>
                    <p className="font-medium text-foreground">{p.display_name}</p>
                    <p className="text-xs text-muted">
                      {p.given_name} {p.family_name}
                    </p>
                  </DataTableCell>
                  <DataTableCell>{(p.clubs as { name: string } | null)?.name ?? '—'}</DataTableCell>
                  <DataTableCell>
                    <div className="flex gap-1 flex-wrap">
                      {p.is_fighter && (
                        <span className="text-xs bg-accent/10 text-accent px-1.5 py-0.5 rounded">
                          {t('admin.globalProfiles.roleFighter')}
                        </span>
                      )}
                      {p.is_referee && (
                        <span className="text-xs bg-info/10 text-info px-1.5 py-0.5 rounded">
                          {t('admin.globalProfiles.roleReferee')}
                        </span>
                      )}
                      {p.is_workshop_participant && (
                        <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                          {t('admin.globalProfiles.roleWorkshop')}
                        </span>
                      )}
                      {p.is_instructor && (
                        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                          {t('admin.globalProfiles.roleInstructor')}
                        </span>
                      )}
                    </div>
                  </DataTableCell>
                  <DataTableCell className="text-muted">{p.country_code ?? '—'}</DataTableCell>
                  <DataTableCell>
                    <button
                      type="button"
                      onClick={() => startEditProfile(p)}
                      className="text-xs font-semibold text-accent hover:underline"
                    >
                      {t('actions.edit')}
                    </button>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </DataTable>
          {persons.length > 0 && (
            <p className="text-xs text-muted mt-2">
              {t('admin.globalProfiles.profilesCount', { count: persons.length })}
            </p>
          )}
        </div>
      )}

      {/* ── Tab: Create profile ── */}
      {tab === 'create' && (
        <div className="max-w-2xl">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display font-semibold text-lg sm:text-xl">
                {editingProfile
                  ? t('admin.globalProfiles.editTitle')
                  : t('admin.globalProfiles.createTitle')}
              </h2>
              <p className="text-xs text-muted mt-1">{t('admin.globalProfiles.requiredNote')}</p>
            </div>
            {editingProfile && (
              <Button type="button" variant="back" size="sm" onClick={resetProfileForm}>
                {t('admin.globalProfiles.cancelEdit')}
              </Button>
            )}
          </div>
          {createError && (
            <div className="bg-danger/10 border border-danger/30 text-danger rounded-md px-4 py-3 mb-4 text-sm">
              {createError}
            </div>
          )}

          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">
                  {t('admin.globalProfiles.givenNameLabel')} <span className="text-danger">*</span>
                </label>
                <input
                  value={form.givenName}
                  onChange={(e) => setForm((f) => ({ ...f, givenName: e.target.value }))}
                  className="border border-border rounded-md px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">
                  {t('admin.globalProfiles.familyNameLabel')} <span className="text-danger">*</span>
                </label>
                <input
                  value={form.familyName}
                  onChange={(e) => setForm((f) => ({ ...f, familyName: e.target.value }))}
                  className="border border-border rounded-md px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1">
                {t('admin.globalProfiles.displayNameLabel')}
              </label>
              <input
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                placeholder={
                  form.givenName || form.familyName
                    ? `${form.givenName} ${form.familyName}`.trim()
                    : undefined
                }
                className="border border-border rounded-md px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1">
                {t('admin.globalProfiles.hemaRatingsId')}
              </label>
              <input
                value={form.hemaRatingsId}
                onChange={(e) => setForm((f) => ({ ...f, hemaRatingsId: e.target.value }))}
                className="border border-border rounded-md px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1">
                {t('admin.globalProfiles.email')}
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder={t('admin.globalProfiles.emailPlaceholder')}
                className="border border-border rounded-md px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1">
                {t('admin.globalProfiles.dateOfBirth')}
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={form.dateOfBirth}
                onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
                placeholder={dateFormat.placeholder}
                pattern={dateFormat.htmlPattern}
                className={`rounded-md px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-accent/30 ${
                  form.dateOfBirth && !dateFormat.parse(form.dateOfBirth)
                    ? 'border border-danger'
                    : 'border border-border'
                }`}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-1">
                {t('admin.globalProfiles.clubLabel')}
              </label>
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
                  placeholder={t('admin.globalProfiles.clubSearchPlaceholder')}
                  className="border border-border rounded-md px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
                {form.clubId && (
                  <p className="text-xs text-success mt-1">
                    {t('admin.globalProfiles.clubSelected', { club: form.clubName })}
                  </p>
                )}
                {clubResults.length > 0 && !form.clubId && (
                  <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
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
                          'w-full text-left px-3 py-2 text-sm hover:bg-background flex items-center gap-2',
                          index === activeClubIndex ? 'bg-accent/10' : '',
                        ].join(' ')}
                      >
                        <span>{c.name}</span>
                        {c.abbreviation && (
                          <span className="text-xs text-muted font-mono">{c.abbreviation}</span>
                        )}
                        {(c.city || c.country_code) && (
                          <span className="text-xs text-muted">
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
                    className="border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                  <input
                    value={form.clubCity}
                    onChange={(e) => setForm((f) => ({ ...f, clubCity: e.target.value }))}
                    placeholder={t('admin.globalProfiles.clubCity')}
                    className="border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                  <button
                    type="button"
                    onClick={() => void createClubFromProfileForm()}
                    disabled={creatingClub}
                    className="rounded-md border border-accent/30 px-3 py-2 text-sm font-semibold text-accent hover:bg-accent/10 disabled:opacity-50"
                  >
                    {creatingClub
                      ? t('admin.globalProfiles.creatingClub')
                      : t('admin.globalProfiles.clubCreateFromSearch')}
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground-secondary mb-2">
                {t('admin.globalProfiles.rolesLabel')}
              </label>
              <div className="flex gap-4">
                {(
                  [
                    { key: 'isFighter', label: t('admin.globalProfiles.roleFighterLabel') },
                    { key: 'isReferee', label: t('admin.globalProfiles.roleRefereeLabel') },
                    {
                      key: 'isWorkshopParticipant',
                      label: t('admin.globalProfiles.roleWorkshopLabel'),
                    },
                    { key: 'isInstructor', label: t('admin.globalProfiles.roleInstructorLabel') },
                  ] as {
                    key: keyof Pick<
                      ProfileForm,
                      'isFighter' | 'isReferee' | 'isWorkshopParticipant' | 'isInstructor'
                    >;
                    label: string;
                  }[]
                ).map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={form[key] as boolean}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
                      className="accent-accent"
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
                (!form.isFighter &&
                  !form.isReferee &&
                  !form.isWorkshopParticipant &&
                  !form.isInstructor) ||
                creating
              }
              className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-semibold py-2 px-6 rounded-lg text-sm self-start"
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
            <div className="mb-4 flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger sm:flex-row sm:items-center sm:justify-between">
              <span>{mergeError}</span>
              <button
                type="button"
                onClick={refreshAudits}
                className="w-fit rounded-md border border-danger/30 bg-surface px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10"
              >
                {t('actions.retry')}
              </button>
            </div>
          )}

          <section className="border border-border rounded-lg p-4 mb-6">
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void searchFighters();
                }}
                placeholder={t('admin.globalProfiles.merge.searchPlaceholder')}
                className="border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 w-80"
              />
              <button
                onClick={() => void searchFighters()}
                disabled={loading}
                className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-md text-sm"
              >
                {t('admin.globalProfiles.merge.searchAction')}
              </button>
            </div>
            {fighters.length > 0 && (
              <div className="mt-4">
                <DataTable>
                  <DataTableHead>
                    <DataTableCell as="th">
                      {t('admin.globalProfiles.merge.colFighter')}
                    </DataTableCell>
                    <DataTableCell as="th">
                      {t('admin.globalProfiles.merge.colHemaRatings')}
                    </DataTableCell>
                    <DataTableCell as="th">
                      {t('admin.globalProfiles.merge.colSelect')}
                    </DataTableCell>
                  </DataTableHead>
                  <tbody>
                    {fighters.map((fighter) => (
                      <DataTableRow key={fighter.id}>
                        <DataTableCell>
                          <p className="font-medium">{fighter.display_name}</p>
                          <p className="font-mono text-xs text-muted">{fighter.slug}</p>
                        </DataTableCell>
                        <DataTableCell className="text-muted">
                          {fighter.hema_ratings_id ?? '-'}
                        </DataTableCell>
                        <DataTableCell>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setSource(fighter)}
                              className="text-xs text-accent hover:underline"
                            >
                              {t('admin.globalProfiles.merge.markSource')}
                            </button>
                            <button
                              onClick={() => setTarget(fighter)}
                              className="text-xs text-success hover:underline"
                            >
                              {t('admin.globalProfiles.merge.markTarget')}
                            </button>
                          </div>
                        </DataTableCell>
                      </DataTableRow>
                    ))}
                  </tbody>
                </DataTable>
              </div>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2 mb-6">
            <FighterCard label={t('admin.globalProfiles.merge.sourceCardLabel')} fighter={source} />
            <FighterCard label={t('admin.globalProfiles.merge.targetCardLabel')} fighter={target} />
          </div>

          <section className="border border-border rounded-lg p-4 mb-8">
            <h2 className="font-display font-semibold text-lg sm:text-xl mb-4">
              {t('admin.globalProfiles.merge.confirmTitle')}
            </h2>
            <div className="grid gap-3 lg:grid-cols-2">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('admin.globalProfiles.merge.reasonPlaceholder')}
                className="border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              <input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={
                  source
                    ? t('admin.globalProfiles.merge.typePrefix', { name: source.display_name })
                    : t('admin.globalProfiles.merge.selectSourceFirst')
                }
                className="border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </div>
            <button
              onClick={() => void mergeFighters()}
              disabled={!source || !target || confirmName !== source?.display_name}
              className="mt-3 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-md text-sm"
            >
              {t('admin.globalProfiles.merge.mergeAction')}
            </button>
          </section>

          <section>
            <h2 className="font-display font-semibold text-lg sm:text-xl mb-3">
              {t('admin.globalProfiles.merge.recentTitle')}
            </h2>
            {audits.length === 0 ? (
              <p className="text-muted text-sm">{t('admin.globalProfiles.merge.noMerges')}</p>
            ) : (
              <DataTable>
                <DataTableHead>
                  <DataTableCell as="th">{t('admin.globalProfiles.merge.colMerge')}</DataTableCell>
                  <DataTableCell as="th">{t('admin.globalProfiles.merge.colReason')}</DataTableCell>
                  <DataTableCell as="th">
                    {t('admin.globalProfiles.merge.colCreated')}
                  </DataTableCell>
                  <DataTableCell as="th">
                    {t('admin.globalProfiles.merge.colMergeActions')}
                  </DataTableCell>
                </DataTableHead>
                <tbody>
                  {audits.map((audit) => (
                    <DataTableRow key={audit.id}>
                      <DataTableCell>
                        <p>
                          {audit.payload_json.source?.display_name ??
                            audit.payload_json.source?.id ??
                            audit.entity_id}
                          {' -> '}
                          {audit.payload_json.target?.display_name ??
                            audit.payload_json.target?.id ??
                            '-'}
                        </p>
                        <p className="text-xs text-muted">
                          {t('admin.globalProfiles.merge.movedSummary', {
                            persons: audit.payload_json.moved?.personIds?.length ?? 0,
                            registrations: audit.payload_json.moved?.registrationIds?.length ?? 0,
                            instructors:
                              audit.payload_json.moved?.workshopInstructorIds?.length ?? 0,
                          })}
                        </p>
                      </DataTableCell>
                      <DataTableCell>{audit.payload_json.reason ?? '-'}</DataTableCell>
                      <DataTableCell className="text-muted">
                        {new Date(audit.created_at).toLocaleDateString(localeToBcp47(locale))}
                      </DataTableCell>
                      <DataTableCell>
                        <button
                          onClick={() => void revertMerge(audit.id)}
                          disabled={nowMs === null || !canRevert(audit.created_at, nowMs)}
                          className="text-xs text-accent hover:underline disabled:text-muted"
                        >
                          {t('admin.globalProfiles.merge.revert')}
                        </button>
                      </DataTableCell>
                    </DataTableRow>
                  ))}
                </tbody>
              </DataTable>
            )}
          </section>
        </div>
      )}
      {confirmDialog}
    </main>
  );
}
