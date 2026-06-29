'use client';

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { getDateFormat } from '@myclash/types';
import { Button, Card, ClubCombobox, type ClubOption, type ClubValue } from '@myclash/ui';
import { useI18n } from '../../../src/i18n/I18nProvider';

interface ClubLink {
  role?: string;
  clubs?: { id?: string | null; name?: string | null } | null;
}

interface WeaponLink {
  favorite?: boolean;
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

interface DashboardResponse {
  profile: FighterProfile;
  career: {
    stats: {
      overall: {
        wins: number;
        losses: number;
        doubleHitPercentage: number;
        matches: number;
      };
    };
  };
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
  selectedWeapons: Record<string, { name: string; favorite: boolean }>;
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
    selectedWeapons[id] = { name, favorite: Boolean(weapon.favorite) };
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

function formatDuration(
  ms: number,
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  if (ms <= 0) return t('common.none');
  return t('publicApp.fighterProfile.minutes', { count: Math.round(ms / 60000) });
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
      else selectedWeapons[weapon.id] = { name: weapon.name, favorite: false };
      return { ...current, selectedWeapons };
    });
  };

  const toggleFavorite = (weapon: WeaponCatalogEntry) => {
    setForm((current) => ({
      ...current,
      selectedWeapons: {
        ...current.selectedWeapons,
        [weapon.id]: {
          name: weapon.name,
          favorite: !current.selectedWeapons[weapon.id]?.favorite,
        },
      },
    }));
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
      <Card>
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
          <div className="grid gap-2 sm:grid-cols-2">
            {weapons.map((weapon) => {
              const selected = Boolean(form.selectedWeapons[weapon.id]);
              const selectedId = `fighter-weapon-${weapon.id}`;
              const favoriteId = `fighter-weapon-favorite-${weapon.id}`;
              return (
                <div
                  key={weapon.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2"
                >
                  <label
                    className="flex items-center gap-2 text-sm text-foreground"
                    htmlFor={selectedId}
                  >
                    <input
                      id={selectedId}
                      type="checkbox"
                      aria-label={weapon.name}
                      checked={selected}
                      onChange={() => toggleWeapon(weapon)}
                    />
                    {weapon.name}
                  </label>
                  <label
                    className="flex items-center gap-1 text-xs text-muted"
                    htmlFor={favoriteId}
                  >
                    <input
                      id={favoriteId}
                      type="checkbox"
                      aria-label={`${weapon.name} ${t('publicApp.fighterProfile.favorite')}`}
                      checked={Boolean(form.selectedWeapons[weapon.id]?.favorite)}
                      disabled={!selected}
                      onChange={() => toggleFavorite(weapon)}
                    />
                    {t('publicApp.fighterProfile.favorite')}
                  </label>
                </div>
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
        <Card>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-accent">
            {t('publicApp.fighterProfile.stats')}
          </h2>
          <div className="grid gap-2">
            <DashboardStat
              label={t('publicApp.fighterProfile.totalWins')}
              value={dashboard.career.stats.overall.wins}
            />
            <DashboardStat
              label={t('publicApp.fighterProfile.totalLosses')}
              value={dashboard.career.stats.overall.losses}
            />
            <DashboardStat
              label={t('publicApp.fighterProfile.doubleHitPercentage')}
              value={`${dashboard.career.stats.overall.doubleHitPercentage.toFixed(2)}%`}
            />
          </div>
          {dashboard.refereeStats && dashboard.refereeStats.totalMatches > 0 && (
            <div className="mt-5 border-t border-border pt-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-accent">
                {t('publicApp.fighterProfile.refereeing')}
              </h2>
              <div className="grid gap-2">
                <DashboardStat
                  label={t('publicApp.fighterProfile.refereeMatches')}
                  value={dashboard.refereeStats.totalMatches}
                />
                <DashboardStat
                  label={t('publicApp.fighterProfile.averageRefereeTime')}
                  value={formatDuration(dashboard.refereeStats.averageRefereeTimeMs, t)}
                />
                <DashboardStat
                  label={t('publicApp.fighterProfile.yellowCards')}
                  value={dashboard.refereeStats.cards.yellow}
                />
                <DashboardStat
                  label={t('publicApp.fighterProfile.redCards')}
                  value={dashboard.refereeStats.cards.red}
                />
                <DashboardStat
                  label={t('publicApp.fighterProfile.blackCards')}
                  value={dashboard.refereeStats.cards.black}
                />
              </div>
            </div>
          )}
        </Card>
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
