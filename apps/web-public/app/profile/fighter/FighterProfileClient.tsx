'use client';

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { getDateFormat } from '@myclash/types';
import { Button, Card, ClubCombobox, type ClubOption, type ClubValue } from '@myclash/ui';
import { useI18n } from '../../../src/i18n/I18nProvider';

interface ClubLink {
  role?: string;
  clubs?: { id?: string | null; name?: string | null } | null;
}

type WeaponLevel = 'just_for_fun' | 'beginner' | 'intermediate' | 'advanced';

interface WeaponLink {
  favorite?: boolean;
  level?: string | null;
  weapon_catalog?: { id?: string; name?: string | null } | null;
}

interface WeaponCatalogEntry {
  id: string;
  name: string;
}

interface FighterProfile {
  id: string;
  display_name?: string;
  given_name?: string;
  family_name?: string;
  country_code?: string | null;
  dateOfBirth?: string | null;
  bio?: string | null;
  photo_url?: string | null;
  clubs?: ClubLink[];
  weapons?: WeaponLink[];
}

/** Per-scope combat stats (overall or one weapon), as returned by
 *  buildFighterCareer().finalizeStats — see apps/api fighter-career.ts. */
interface WeaponStat {
  weapon?: string;
  matches: number;
  wins: number;
  losses: number;
  winLossRatio: number | null;
  doubleHits: number;
  exchanges: number;
  doubleHitPercentage: number;
}

/** A fighter's final placement in one completed tournament (server-computed via
 *  the shared computeFinalRanking — same order the public tournament page shows). */
interface FighterPlacement {
  tournamentId: string;
  tournamentName: string;
  tournamentSlug: string;
  eventName: string;
  eventSlug: string;
  weapon: string | null;
  date: string | null;
  place: number | null;
  resultKind: string | null;
  totalRanked: number | null;
}

interface DashboardResponse {
  profile: FighterProfile;
  career: {
    eventParticipation: Array<{ startDate?: string | null }>;
    tournamentPlacements: FighterPlacement[];
    upcoming: unknown[];
    leagueRankings: Array<{ leagueName: string; rank: number; totalPoints: number }>;
    recentForm: Array<{
      matchId: string;
      date: string | null;
      outcome: 'win' | 'loss' | 'draw';
      ourScore: number;
      opponentScore: number;
    }>;
    currentStreak: { kind: 'win' | 'loss' | 'none'; count: number };
    stats: {
      overall: WeaponStat;
      byWeapon: Array<WeaponStat & { weapon: string }>;
      byYear: Array<WeaponStat & { year: string }>;
    };
  };
  // Per-weapon HEMA Ratings, surfaced by getMyDashboard when a hema_ratings_id
  // is linked. `ratings[].weapon` may not exactly match the tournament-derived
  // byWeapon keys — matched case-insensitively at render, hidden on no match.
  hemaRatings?: {
    /** Outbound link to the fighter's hemaratings.com profile. */
    detailsUrl?: string;
    ratings: Array<{ weapon: string; rank: number | null; weightedRating: number }>;
  } | null;
  refereeStats?: RefereeStats;
}

interface RefereeStats {
  totalMatches: number;
  averageRefereeTimeMs: number;
  roles: {
    arbitre_declarant: number;
    arbitre_assesseur: number;
    arbitre_table: number;
  };
  cards: {
    yellow: number;
    red: number;
    black: number;
  };
  bestBuddies: Array<{
    userId: string;
    displayName: string | null;
    matchesTogether: number;
  }>;
  history?: Array<{
    matchId: string;
    role: string | null;
    eventName: string | null;
    tournamentName: string | null;
    weapon: string | null;
    scheduledAt: string | null;
    durationMs: number;
  }>;
}

interface FormState {
  displayName: string;
  givenName: string;
  familyName: string;
  nationality: string;
  dateOfBirth: string;
  bio: string;
  photoUrl: string;
  mainClub: ClubValue | null;
  secondaryClubs: ClubValue[];
  previousClubs: ClubValue[];
  selectedWeapons: Record<string, { name: string; favorite: boolean; level: WeaponLevel | null }>;
}

const emptyForm: FormState = {
  displayName: '',
  givenName: '',
  familyName: '',
  nationality: '',
  dateOfBirth: '',
  bio: '',
  photoUrl: '',
  mainClub: null,
  secondaryClubs: [],
  previousClubs: [],
  selectedWeapons: {},
};

/** Build the ClubCombobox values for a given role from the profile club links,
 *  carrying the club id so an existing club re-saves by id (never duplicated). */
function clubValuesByRole(clubs: ClubLink[] | undefined, role: string): ClubValue[] {
  return (clubs ?? [])
    .filter((club) => club.role === role && club.clubs?.name)
    .map((club) => ({ clubId: club.clubs?.id ?? null, clubName: club.clubs?.name ?? '' }));
}

/** A picked club re-saves by id; a typed-but-new one saves by name (the API
 *  resolves the name → an unverified club). */
function toClubInput(value: ClubValue): { clubId: string } | { clubName: string } {
  return value.clubId ? { clubId: value.clubId } : { clubName: value.clubName };
}

function formFromProfile(profile: FighterProfile, formatDob: (iso: string) => string): FormState {
  const selectedWeapons: FormState['selectedWeapons'] = {};
  for (const weapon of profile.weapons ?? []) {
    const id = weapon.weapon_catalog?.id;
    const name = weapon.weapon_catalog?.name;
    if (!id || !name) continue;
    selectedWeapons[id] = {
      name,
      favorite: Boolean(weapon.favorite),
      level: (weapon.level as WeaponLevel | null) ?? null,
    };
  }

  const mainClubs = clubValuesByRole(profile.clubs, 'main');
  return {
    displayName: profile.display_name ?? '',
    givenName: profile.given_name ?? '',
    familyName: profile.family_name ?? '',
    nationality: profile.country_code ?? '',
    dateOfBirth: formatDob(profile.dateOfBirth ?? ''),
    bio: profile.bio ?? '',
    photoUrl: profile.photo_url ?? '',
    mainClub: mainClubs[0] ?? null,
    secondaryClubs: clubValuesByRole(profile.clubs, 'secondary'),
    previousClubs: clubValuesByRole(profile.clubs, 'previous'),
    selectedWeapons,
  };
}

export function FighterProfileClient({ apiUrl }: { apiUrl: string }) {
  const { t, locale } = useI18n();
  const dateFormat = useMemo(() => getDateFormat(locale), [locale]);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [weapons, setWeapons] = useState<WeaponCatalogEntry[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Roster registrations matching the logged-in user's email but not yet
  // claimed — surfaced as a confirm-to-claim step instead of dead-ending when
  // no Fighter profile is linked yet.
  const [claimable, setClaimable] = useState<
    Array<{ id: string; name: string; eventName: string }>
  >([]);
  const [claiming, setClaiming] = useState(false);

  // Async fuzzy club search powering every ClubCombobox (main + secondary +
  // previous). The combobox stays API-agnostic; the URL lives here.
  const searchClubs = useCallback(
    async (query: string): Promise<ClubOption[]> => {
      const url = `${apiUrl}/api/v1/clubs?q=${encodeURIComponent(query)}&searchAbv=true`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return [];
      const data = (await res.json()) as
        | Array<{ id: string; name: string; city?: string | null; abbreviation?: string | null }>
        | {
            clubs?: Array<{
              id: string;
              name: string;
              city?: string | null;
              abbreviation?: string | null;
            }>;
          };
      const rows = Array.isArray(data) ? data : (data.clubs ?? []);
      return rows
        .filter((c) => c.id && c.name)
        .map((c) => ({
          id: c.id,
          name: c.name,
          city: c.city ?? null,
          abbreviation: c.abbreviation ?? null,
        }));
    },
    [apiUrl],
  );

  const loadClaimable = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/me/personal-space`, { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as {
        claimable?: Array<{ id: string; name: string; eventName: string }>;
      };
      setClaimable(Array.isArray(data.claimable) ? data.claimable : []);
    } catch {
      // ignore — fall back to the generic access-required message
    }
  }, [apiUrl]);

  // No synchronous setLoading(true) here: the initial mount relies on the
  // `loading` state's initial `true`, and the claim re-load sets it from its
  // async callback below. Keeping it out of `load` lets the mount effect call
  // load() without tripping set-state-in-effect.
  const load = useCallback(() => {
    Promise.all([
      fetch(`${apiUrl}/api/v1/fighters/me/dashboard`, { credentials: 'include' }),
      fetch(`${apiUrl}/api/v1/weapons`, { credentials: 'include' }),
    ])
      .then(async ([dashboardResponse, weaponsResponse]) => {
        if (!dashboardResponse.ok) {
          // Logged in but no Fighter profile linked yet → offer the
          // confirm-to-claim step rather than a dead-end error.
          await loadClaimable();
          setError(t('publicApp.fighterProfile.loadError'));
          return;
        }
        const nextDashboard = (await dashboardResponse.json()) as DashboardResponse;
        const nextWeapons = weaponsResponse.ok
          ? ((await weaponsResponse.json()) as WeaponCatalogEntry[])
          : [];
        setDashboard(nextDashboard);
        setWeapons(nextWeapons);
        setError(null);
        setForm(formFromProfile(nextDashboard.profile, dateFormat.format));
      })
      .catch(() => {
        setError(t('publicApp.fighterProfile.loadError'));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [apiUrl, t, dateFormat, loadClaimable]);

  const claim = (personId: string) => {
    setClaiming(true);
    fetch(`${apiUrl}/api/v1/me/claim-persons`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personIds: [personId] }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('claim');
        // Claiming links the global profile → the dashboard now resolves.
        setClaimable([]);
        setLoading(true);
        load();
      })
      .catch(() => {
        setError(t('publicApp.personalSpace.claimable.error'));
      })
      .finally(() => {
        setClaiming(false);
      });
  };

  useEffect(() => {
    load();
  }, [load]);

  const selectedWeaponRows = useMemo(
    () =>
      Object.entries(form.selectedWeapons).map(([weaponId, weapon]) => ({
        weaponId,
        weaponName: weapon.name,
        favorite: weapon.favorite,
        level: weapon.level,
      })),
    [form.selectedWeapons],
  );

  const updateField = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const toggleWeapon = (weapon: WeaponCatalogEntry) => {
    setForm((current) => {
      const selectedWeapons = { ...current.selectedWeapons };
      if (selectedWeapons[weapon.id]) delete selectedWeapons[weapon.id];
      else selectedWeapons[weapon.id] = { name: weapon.name, favorite: false, level: null };
      return { ...current, selectedWeapons };
    });
  };

  const toggleFavorite = (weapon: WeaponCatalogEntry) => {
    setForm((current) => {
      const existing = current.selectedWeapons[weapon.id];
      if (!existing) return current;
      return {
        ...current,
        selectedWeapons: {
          ...current.selectedWeapons,
          [weapon.id]: { ...existing, favorite: !existing.favorite },
        },
      };
    });
  };

  const setWeaponLevel = (weapon: WeaponCatalogEntry, level: WeaponLevel | null) => {
    setForm((current) => {
      const existing = current.selectedWeapons[weapon.id];
      if (!existing) return current;
      return {
        ...current,
        selectedWeapons: {
          ...current.selectedWeapons,
          [weapon.id]: { ...existing, level },
        },
      };
    });
  };

  const save = () => {
    if (!dashboard) return;
    // Convert the locale-formatted DOB back to ISO before PATCH.
    // Empty is fine (DOB optional); non-empty + unparseable surfaces
    // an inline error and aborts before we leak a malformed value.
    let dateOfBirthIso: string | undefined;
    if (form.dateOfBirth.trim()) {
      const parsed = dateFormat.parse(form.dateOfBirth);
      if (!parsed) {
        setError(t('publicApp.fighterProfile.errors.dobFormat'));
        return;
      }
      dateOfBirthIso = parsed;
    }
    setSaving(true);
    setMessage(null);
    setError(null);
    fetch(`${apiUrl}/api/v1/fighters/me/profile`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fighterId: dashboard.profile.id,
        displayName: form.displayName,
        givenName: form.givenName,
        familyName: form.familyName,
        countryCode: form.nationality || undefined,
        dateOfBirth: dateOfBirthIso,
        bio: form.bio || undefined,
        photoUrl: form.photoUrl || undefined,
        mainClub: form.mainClub ? toClubInput(form.mainClub) : undefined,
        secondaryClubs: form.secondaryClubs.map(toClubInput),
        previousClubs: form.previousClubs.map(toClubInput),
        weapons: selectedWeaponRows,
      }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('save');
        const profile = (await response.json()) as FighterProfile;
        setDashboard((current) => (current ? { ...current, profile } : current));
        setForm(formFromProfile(profile, dateFormat.format));
        setMessage(t('publicApp.fighterProfile.saveSuccess'));
      })
      .catch(() => {
        setError(t('publicApp.fighterProfile.saveError'));
      })
      .finally(() => {
        setSaving(false);
      });
  };

  if (loading) {
    return (
      <Card className="text-sm text-muted">{t('publicApp.fighterProfile.loadingDashboard')}</Card>
    );
  }

  if (error && !dashboard) {
    // No Fighter profile linked yet. If the user has roster registrations on
    // their email, offer to claim one (which links the profile and unlocks the
    // dashboard); otherwise point them to their personal space.
    if (claimable.length > 0) {
      return (
        <Card>
          <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
            {t('publicApp.personalSpace.claimable.title')}
          </h2>
          <p className="mt-1 text-xs text-muted">
            {t('publicApp.personalSpace.claimable.description')}
          </p>
          <ul className="mt-3 space-y-2">
            {claimable.map((person) => (
              <li
                key={person.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
              >
                <span className="min-w-0 text-sm text-foreground">
                  <span className="font-semibold">{person.name}</span>
                  {person.eventName && <span className="text-muted"> — {person.eventName}</span>}
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={claiming}
                  onClick={() => claim(person.id)}
                >
                  {t('publicApp.personalSpace.claimable.claim')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      );
    }
    return (
      <div className="rounded-xl border border-danger/40 bg-danger/5 p-4">
        <p className="text-sm text-danger">{error}</p>
        <p className="mt-2 text-xs text-muted">{t('publicApp.fighterProfile.accessRequired')}</p>
        <Button asChild variant="secondary" size="sm" className="mt-3">
          <a href="/me">{t('publicApp.fighterProfile.goToPersonalSpace')}</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <Card className="order-2 lg:order-none">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('publicApp.fighterProfile.displayName')}
            value={form.displayName}
            onChange={(value) => updateField('displayName', value)}
          />
          <Field
            label={t('publicApp.fighterProfile.nationality')}
            value={form.nationality}
            onChange={(value) => updateField('nationality', value.toUpperCase().slice(0, 2))}
          />
          <Field
            label={t('publicApp.fighterProfile.givenName')}
            value={form.givenName}
            onChange={(value) => updateField('givenName', value)}
          />
          <Field
            label={t('publicApp.fighterProfile.familyName')}
            value={form.familyName}
            onChange={(value) => updateField('familyName', value)}
          />
          <Field
            label={t('publicApp.fighterProfile.dateOfBirth')}
            type="text"
            value={form.dateOfBirth}
            onChange={(value) => updateField('dateOfBirth', value)}
            placeholder={dateFormat.placeholder}
            hint={
              form.dateOfBirth && !dateFormat.parse(form.dateOfBirth)
                ? t('publicApp.fighterProfile.errors.dobFormat')
                : undefined
            }
          />
          <Field
            label={t('publicApp.fighterProfile.photoUrl')}
            value={form.photoUrl}
            onChange={(value) => updateField('photoUrl', value)}
          />
        </div>

        <label className="mt-3 block text-sm" htmlFor="fighter-profile-bio">
          <span className="text-foreground-secondary">{t('publicApp.fighterProfile.bio')}</span>
          <textarea
            id="fighter-profile-bio"
            aria-label={t('publicApp.fighterProfile.bio')}
            className="mt-1 min-h-28 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            value={form.bio}
            onChange={(event) => updateField('bio', event.target.value)}
          />
        </label>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <ClubField label={t('publicApp.fighterProfile.mainClub')}>
            <ClubCombobox
              value={form.mainClub}
              onChange={(value) => setForm((current) => ({ ...current, mainClub: value }))}
              searchClubs={searchClubs}
              placeholder={t('publicApp.fighterProfile.clubSearchPlaceholder')}
              createLabel={(q) => t('publicApp.fighterProfile.clubCreate', { name: q })}
              noMatchLabel={t('publicApp.fighterProfile.clubNoMatch')}
              clearLabel={t('publicApp.fighterProfile.clubClear')}
              aria-label={t('publicApp.fighterProfile.mainClub')}
            />
          </ClubField>
          <ClubField
            label={t('publicApp.fighterProfile.secondaryClubs')}
            hint={t('publicApp.fighterProfile.clubMultiHelp')}
          >
            <ClubMultiField
              values={form.secondaryClubs}
              onChange={(values) => setForm((current) => ({ ...current, secondaryClubs: values }))}
              searchClubs={searchClubs}
              t={t}
            />
          </ClubField>
          <ClubField
            label={t('publicApp.fighterProfile.previousClubs')}
            hint={t('publicApp.fighterProfile.clubMultiHelp')}
          >
            <ClubMultiField
              values={form.previousClubs}
              onChange={(values) => setForm((current) => ({ ...current, previousClubs: values }))}
              searchClubs={searchClubs}
              t={t}
            />
          </ClubField>
        </div>

        <div className="mt-4">
          <h2 className="mb-2 font-display font-semibold text-lg sm:text-xl text-foreground">
            {t('publicApp.fighterProfile.weapons')}
          </h2>
          <p className="mb-2 text-xs text-muted">{t('publicApp.fighterProfile.weaponsHint')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {weapons.map((weapon) => {
              const entry = form.selectedWeapons[weapon.id];
              return (
                <WeaponCard
                  key={weapon.id}
                  name={weapon.name}
                  selected={Boolean(entry)}
                  favorite={Boolean(entry?.favorite)}
                  level={entry?.level ?? null}
                  onToggle={() => toggleWeapon(weapon)}
                  onToggleFavorite={() => toggleFavorite(weapon)}
                  onLevelChange={(level) => setWeaponLevel(weapon, level)}
                  t={t}
                />
              );
            })}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <Button variant="primary" onClick={save} loading={saving} disabled={saving}>
            {t('actions.save')}
          </Button>
          {message && <p className="text-sm text-success">{message}</p>}
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      </Card>

      {dashboard && (
        <FighterStatsCard dashboard={dashboard} t={t} className="order-1 lg:order-none" />
      )}
    </div>
  );
}

/** Label + hint wrapper around a club control (combobox or multi-combobox). */
function ClubField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="block text-sm">
      <span className="text-foreground-secondary">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </div>
  );
}

/** A list of clubs as stacked ClubComboboxes (clearing a row removes it); the
 *  trailing empty combobox appends a new club when picked/created. */
function ClubMultiField({
  values,
  onChange,
  searchClubs,
  t,
}: {
  values: ClubValue[];
  onChange: (values: ClubValue[]) => void;
  searchClubs: (query: string) => Promise<ClubOption[]>;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const comboProps = {
    searchClubs,
    placeholder: t('publicApp.fighterProfile.clubSearchPlaceholder'),
    createLabel: (q: string) => t('publicApp.fighterProfile.clubCreate', { name: q }),
    noMatchLabel: t('publicApp.fighterProfile.clubNoMatch'),
    clearLabel: t('publicApp.fighterProfile.clubClear'),
  };
  return (
    <div className="flex flex-col gap-2">
      {values.map((value, index) => (
        <ClubCombobox
          key={value.clubId ?? `name-${index}`}
          value={value}
          onChange={(next) => {
            const list = values.slice();
            if (next === null) list.splice(index, 1);
            else list[index] = next;
            onChange(list);
          }}
          aria-label={t('publicApp.fighterProfile.clubRowLabel', { index: index + 1 })}
          {...comboProps}
        />
      ))}
      <ClubCombobox
        key={`add-${values.length}`}
        value={null}
        onChange={(next) => {
          if (next) onChange([...values, next]);
        }}
        aria-label={t('publicApp.fighterProfile.clubAdd')}
        {...comboProps}
      />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  hint,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
  placeholder?: string;
}) {
  const inputId = useId();
  return (
    <label className="block text-sm" htmlFor={inputId}>
      <span className="text-foreground-secondary">{label}</span>
      <input
        id={inputId}
        type={type}
        aria-label={label}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function DashboardStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-3">
      <p className="text-[11px] uppercase tracking-widest text-muted">{label}</p>
      <p className="mt-1 text-xl font-black tabular-nums text-foreground">{value}</p>
    </div>
  );
}

type TFn = (key: string, values?: Record<string, string | number>) => string;

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2.6l2.9 5.88 6.49.95-4.7 4.58 1.11 6.46L12 17.98l-5.8 3.05 1.1-6.46-4.69-4.58 6.49-.95z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

/** One weapon in the picker: tap the card to (de)select it, tap the star to
 *  favourite it, and pick a self-rated level once selected. */
function WeaponCard({
  name,
  selected,
  favorite,
  level,
  onToggle,
  onToggleFavorite,
  onLevelChange,
  t,
}: {
  name: string;
  selected: boolean;
  favorite: boolean;
  level: WeaponLevel | null;
  onToggle: () => void;
  onToggleFavorite: () => void;
  onLevelChange: (level: WeaponLevel | null) => void;
  t: TFn;
}) {
  const levelId = useId();
  return (
    <div
      className={[
        'rounded-lg border px-3 py-2 transition-colors',
        selected ? 'border-accent bg-accent/5' : 'border-border bg-background',
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={selected}
          aria-label={name}
          className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-foreground [touch-action:manipulation]"
        >
          <span
            aria-hidden
            className={[
              'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
              selected
                ? 'border-accent bg-accent text-accent-foreground'
                : 'border-border text-transparent',
            ].join(' ')}
          >
            <CheckIcon />
          </span>
          <span className="min-w-0 truncate">{name}</span>
        </button>
        <button
          type="button"
          onClick={onToggleFavorite}
          disabled={!selected}
          aria-pressed={favorite}
          aria-label={`${name} — ${t('publicApp.fighterProfile.favorite')}`}
          className={[
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-md transition-colors [touch-action:manipulation]',
            'disabled:opacity-30 enabled:hover:text-accent',
            favorite ? 'text-accent' : 'text-muted',
          ].join(' ')}
        >
          <StarIcon filled={favorite} />
        </button>
      </div>
      {selected && (
        <label htmlFor={levelId} className="mt-2 flex items-center gap-2 text-xs text-muted">
          <span className="shrink-0">{t('publicApp.fighterProfile.weaponLevel')}</span>
          <select
            id={levelId}
            value={level ?? ''}
            onChange={(event) => onLevelChange((event.target.value || null) as WeaponLevel | null)}
            className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent [touch-action:manipulation]"
          >
            <option value="">{t('publicApp.fighterProfile.levelUnset')}</option>
            <option value="just_for_fun">{t('publicApp.fighterProfile.levelJustForFun')}</option>
            <option value="beginner">{t('publicApp.fighterProfile.levelBeginner')}</option>
            <option value="intermediate">{t('publicApp.fighterProfile.levelIntermediate')}</option>
            <option value="advanced">{t('publicApp.fighterProfile.levelAdvanced')}</option>
          </select>
        </label>
      )}
    </div>
  );
}

/** Medal glyph for a podium finish; empty for everyone else. */
function medalGlyph(place: number | null): string {
  if (place === 1) return '🥇';
  if (place === 2) return '🥈';
  if (place === 3) return '🥉';
  return '';
}

/** Headline for a placement: a medal word for the podium, otherwise `#N`. */
function placeHeadline(place: number | null, t: TFn): string {
  if (place === 1) return t('publicApp.fighterProfile.resultChampion');
  if (place === 2) return t('publicApp.fighterProfile.resultRunnerUp');
  if (place === 3) return t('publicApp.fighterProfile.resultThird');
  return place != null ? `#${place}` : '—';
}

/** Tokenized chip styling for a recent-form result (win/loss/draw). */
function formChipClass(outcome: 'win' | 'loss' | 'draw'): string {
  const base = 'inline-flex h-6 w-6 items-center justify-center rounded text-xs font-bold';
  if (outcome === 'win') return `${base} bg-success/15 text-success`;
  if (outcome === 'loss') return `${base} bg-danger/15 text-danger`;
  return `${base} bg-foreground/10 text-muted`;
}

/** Career statistics card with a Global / per-weapon tab bar. The combat tiles
 *  shift with the selected tab; the lower block holds tab-independent career
 *  totals. HEMA rank/rating only appear on a weapon tab with a matching rating. */
function FighterStatsCard({
  dashboard,
  t,
  className,
}: {
  dashboard: DashboardResponse;
  t: TFn;
  className?: string;
}) {
  const career = dashboard.career;
  const overall = career.stats.overall;
  const fought = career.stats.byWeapon.filter((weapon) => weapon.matches > 0);
  // Only show tournaments we could actually rank (a decided bracket or pool).
  const placements = career.tournamentPlacements.filter((placement) => placement.place != null);
  const medals = {
    gold: placements.filter((placement) => placement.place === 1).length,
    silver: placements.filter((placement) => placement.place === 2).length,
    bronze: placements.filter((placement) => placement.place === 3).length,
  };
  const medalCount = medals.gold + medals.silver + medals.bronze;
  const timeline = (career.stats.byYear ?? [])
    .filter((year) => year.year !== 'unknown' && year.matches > 0)
    .sort((a, b) => b.year.localeCompare(a.year));
  const streak = career.currentStreak;
  const showInsights = medalCount > 0 || career.recentForm.length > 0 || timeline.length > 0;
  const [statTab, setStatTab] = useState<string>('global');

  const active =
    statTab === 'global'
      ? overall
      : (fought.find((weapon) => weapon.weapon === statTab) ?? overall);

  const hema =
    statTab === 'global'
      ? null
      : ((dashboard.hemaRatings?.ratings ?? []).find(
          (rating) => rating.weapon.toLowerCase() === statTab.toLowerCase(),
        ) ?? null);

  const winRate =
    active.matches === 0 ? '—' : `${Math.round((active.wins / active.matches) * 100)}%`;
  const ratio = active.winLossRatio == null ? '—' : active.winLossRatio.toFixed(2);

  const years = (career.eventParticipation ?? [])
    .map((event) => event.startDate?.slice(0, 4))
    .filter((year): year is string => Boolean(year));
  const activeSince = years.length ? years.reduce((a, b) => (a < b ? a : b)) : null;

  const tabs: Array<{ value: string; label: string }> = [
    { value: 'global', label: t('publicApp.fighterProfile.statsGlobalTab') },
    ...fought.map((weapon) => ({ value: weapon.weapon, label: weapon.weapon })),
  ];

  return (
    <Card className={className}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-accent">
          {t('publicApp.fighterProfile.stats')}
        </h2>
        {dashboard.hemaRatings?.detailsUrl && (
          <a
            href={dashboard.hemaRatings.detailsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-accent hover:underline"
          >
            {t('publicApp.fighterProfile.hemaProfileLink')} ↗
          </a>
        )}
      </div>

      {tabs.length > 1 && (
        <div
          role="tablist"
          aria-label={t('publicApp.fighterProfile.stats')}
          className="mb-3 flex flex-wrap gap-1"
        >
          {tabs.map((tab) => {
            const isActive = tab.value === statTab;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setStatTab(tab.value)}
                className={[
                  'min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors [touch-action:manipulation]',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'border border-border text-muted hover:text-foreground',
                ].join(' ')}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <DashboardStat label={t('publicApp.fighterProfile.matches')} value={active.matches} />
        <DashboardStat label={t('publicApp.fighterProfile.totalWins')} value={active.wins} />
        <DashboardStat label={t('publicApp.fighterProfile.totalLosses')} value={active.losses} />
        <DashboardStat label={t('publicApp.fighterProfile.winRate')} value={winRate} />
        <DashboardStat label={t('publicApp.fighterProfile.winLossRatio')} value={ratio} />
        <DashboardStat
          label={t('publicApp.fighterProfile.doubleHitPercentage')}
          value={`${active.doubleHitPercentage.toFixed(2)}%`}
        />
        <DashboardStat label={t('publicApp.fighterProfile.doubleHits')} value={active.doubleHits} />
        <DashboardStat label={t('publicApp.fighterProfile.exchanges')} value={active.exchanges} />
        {hema?.rank != null && (
          <DashboardStat label={t('publicApp.fighterProfile.hemaRank')} value={`#${hema.rank}`} />
        )}
        {hema != null && (
          <DashboardStat
            label={t('publicApp.fighterProfile.hemaRating')}
            value={Math.round(hema.weightedRating)}
          />
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-4">
        <DashboardStat
          label={t('publicApp.fighterProfile.eventsAttended')}
          value={career.eventParticipation.length}
        />
        <DashboardStat
          label={t('publicApp.fighterProfile.tournamentsAttended')}
          value={career.tournamentPlacements.length}
        />
        {career.upcoming.length > 0 && (
          <DashboardStat
            label={t('publicApp.fighterProfile.upcoming')}
            value={career.upcoming.length}
          />
        )}
        {activeSince && (
          <DashboardStat label={t('publicApp.fighterProfile.activeSince')} value={activeSince} />
        )}
        {career.leagueRankings.map((league, index) => (
          <DashboardStat
            key={`${league.leagueName}-${index}`}
            label={league.leagueName}
            value={t('publicApp.fighterProfile.leagueValue', {
              rank: league.rank,
              points: league.totalPoints,
            })}
          />
        ))}
      </div>

      {placements.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent">
            {t('publicApp.fighterProfile.resultsTitle')}
          </h3>
          <ul className="space-y-1.5">
            {placements.map((placement) => (
              <li key={placement.tournamentId}>
                <a
                  href={`/e/${placement.eventSlug}/t/${placement.tournamentSlug}#finalranking`}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 hover:bg-foreground/5"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {medalGlyph(placement.place) && (
                      <span aria-hidden className="text-base leading-none">
                        {medalGlyph(placement.place)}
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-foreground">
                        {placement.tournamentName}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {[placement.eventName, placement.weapon, placement.date?.slice(0, 4)]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </span>
                  <span className="flex-shrink-0 text-right">
                    <span className="block text-sm font-bold text-foreground">
                      {placeHeadline(placement.place, t)}
                    </span>
                    {placement.totalRanked != null && (
                      <span className="block text-xs text-muted">
                        {t('publicApp.fighterProfile.resultOfTotal', {
                          total: placement.totalRanked,
                        })}
                      </span>
                    )}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showInsights && (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent">
            {t('publicApp.fighterProfile.insightsTitle')}
          </h3>

          {medalCount > 0 && (
            <div className="mb-2 flex flex-wrap gap-3 text-sm font-semibold text-foreground">
              {medals.gold > 0 && (
                <span>
                  <span aria-hidden>🥇</span> {medals.gold}
                </span>
              )}
              {medals.silver > 0 && (
                <span>
                  <span aria-hidden>🥈</span> {medals.silver}
                </span>
              )}
              {medals.bronze > 0 && (
                <span>
                  <span aria-hidden>🥉</span> {medals.bronze}
                </span>
              )}
            </div>
          )}

          {streak.kind !== 'none' && streak.count > 1 && (
            <p className="mb-2 text-xs font-semibold text-muted">
              {t(
                streak.kind === 'win'
                  ? 'publicApp.fighterProfile.streakWin'
                  : 'publicApp.fighterProfile.streakLoss',
                { count: streak.count },
              )}
            </p>
          )}

          {career.recentForm.length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-xs font-semibold text-muted">
                {t('publicApp.fighterProfile.recentForm')}
              </p>
              <div className="flex flex-wrap gap-1">
                {career.recentForm.map((formMatch) => (
                  <span
                    key={formMatch.matchId}
                    className={formChipClass(formMatch.outcome)}
                    title={`${formMatch.ourScore}-${formMatch.opponentScore}`}
                  >
                    {formMatch.outcome === 'win'
                      ? t('publicApp.fighterProfile.formWinShort')
                      : formMatch.outcome === 'loss'
                        ? t('publicApp.fighterProfile.formLossShort')
                        : t('publicApp.fighterProfile.formDrawShort')}
                  </span>
                ))}
              </div>
            </div>
          )}

          {timeline.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">
                {t('publicApp.fighterProfile.timeline')}
              </p>
              <ul className="space-y-1">
                {timeline.map((year) => (
                  <li key={year.year} className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground">{year.year}</span>
                    <span className="text-muted">
                      {t('publicApp.fighterProfile.timelineRecord', {
                        wins: year.wins,
                        losses: year.losses,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
