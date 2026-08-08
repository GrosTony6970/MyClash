'use client';

import { useI18n } from '../../src/i18n/I18nProvider';
import { useScoringTheme } from '../../src/theme/ThemeProvider';
import { PersonRow } from '../../src/components/PersonRow';
import { useGear, type GearEntry } from '../../src/lib/useGear';
import { WeaponRow } from './WeaponRow';

/**
 * The gear-check table.
 *
 * Deliberately the check-in desk's screen with a different action strip, not a
 * second screen: the search, the person row, the photo-and-club confirmation
 * are the same and share `PersonRow`. What differs is that a pass is per
 * WEAPON, so each person expands into one line per weapon they are entered in,
 * each with its own state and its own actions.
 *
 * Nothing here gates anything. A failed check does not stop a match — the
 * referee at the piste decides.
 */
export default function GearPage() {
  const { t } = useI18n();
  const { chromeScope } = useScoringTheme();
  const gear = useGear();

  return (
    <main data-theme={chromeScope} className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col p-4">
        <h1 className="mb-3 font-display text-xl font-bold">{t('scoring.gear.title')}</h1>

        <input
          type="search"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- single-purpose desk screen; the search IS the page
          autoFocus
          value={gear.query}
          onChange={(event) => gear.setQuery(event.target.value)}
          placeholder={t('scoring.desk.searchPlaceholder')}
          aria-label={t('scoring.desk.searchPlaceholder')}
          className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-lg text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent"
        />

        {gear.error && <p className="mt-3 text-sm text-danger">{t('scoring.desk.actionError')}</p>}

        <GearList entries={gear.entries} loading={gear.loading} onRecord={gear.recordCheck} />

        <footer className="sticky bottom-0 mt-4 border-t border-border bg-background py-3">
          <span className="text-sm text-muted">
            {gear.summary
              ? t('scoring.gear.checkedCount', {
                  checked: String(gear.summary.checked),
                  total: String(gear.summary.total),
                })
              : ''}
          </span>
        </footer>
      </div>
    </main>
  );
}

function GearList({
  entries,
  loading,
  onRecord,
}: {
  entries: GearEntry[];
  loading: boolean;
  onRecord: ReturnType<typeof useGear>['recordCheck'];
}) {
  const { t } = useI18n();

  return (
    <div className="mt-3 flex-1 space-y-2">
      {loading && <p className="text-sm text-muted">{t('scoring.desk.loading')}</p>}
      {!loading && entries.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
          {t('scoring.desk.noResults')}
        </p>
      )}
      {entries.map((entry) => (
        <PersonRow key={entry.person.personId} person={entry.person} actions={null}>
          <div className="mt-3 space-y-3 border-t border-border pt-3">
            {entry.weapons.length === 0 ? (
              // `tournaments.weapon` is free text, so a name that fails to
              // resolve to a catalog entry is real and silent. Saying so beats
              // showing a person with no actions and no explanation.
              <p className="text-xs text-warning">{t('scoring.gear.noWeapons')}</p>
            ) : (
              entry.weapons.map((weapon) => (
                <WeaponRow
                  key={weapon.weaponId}
                  weapon={weapon}
                  onRecord={(result, reason) =>
                    onRecord(entry.person.personId, weapon.weaponId, result, reason)
                  }
                />
              ))
            )}
          </div>
        </PersonRow>
      ))}
    </div>
  );
}
