'use client';

import { useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { SegmentedTabs, StatusBadge } from '@myclash/ui';
import { failureMessage } from '@myclash/api-client';
import { useScoringTheme } from '../../src/theme/ThemeProvider';
import { PersonRow } from '../../src/components/PersonRow';
import { RosterNotice } from '../../src/components/RosterNotice';
import { useGear, type GearEntry } from '../../src/lib/useGear';
import {
  countMatchingQuery,
  countsByStanding,
  standingFor,
  standingSemantic,
  visibleGear,
  type GearCounts,
  type GearStanding,
  type GearTab,
} from '../../src/lib/gear-standing';
import { WeaponRow } from './WeaponRow';

// Literal keys, never a template — a computed t() key is invisible to
// t-key-references.test.ts, so its French string would ship missing.
const STANDING_KEYS: Record<GearStanding, string> = {
  unchecked: 'scoring.gear.standingUnchecked',
  pass: 'scoring.gear.standingPass',
  conditional: 'scoring.gear.standingConditional',
  fail: 'scoring.gear.standingFail',
};

/**
 * The gear-check table.
 *
 * Deliberately the check-in desk's screen with a different action strip, not a
 * second screen: the search, the person row, the photo-and-club confirmation
 * are the same and share `PersonRow`. What differs is that a pass is per
 * WEAPON, so each person expands into one line per weapon they are entered in,
 * each with its own state and its own actions.
 *
 * ── One person, one tab ─────────────────────────────────────────────────────
 * The tabs group PEOPLE, because the volunteer is looking for someone to call
 * over, not for a weapon. A fighter whose weapons disagree takes their worst
 * result — `standingFor` holds that rule and why. The chip on the row states
 * the same standing the tabs sort by, so a face in the Fail tab says Fail
 * without anyone reading three weapon lines.
 *
 * Nothing here gates anything. A failed check does not stop a match — the
 * referee at the piste decides.
 */
export default function GearPage() {
  const { t } = useI18n();
  const { chromeScope } = useScoringTheme();
  const gear = useGear();
  const [tab, setTab] = useState<GearTab>('all');
  // The server's own reason, with our sentence only as the fallback. Every
  // refusal used to read "That did not save. Try again." — including a 403 from
  // the edge, which no amount of trying again would have cleared.
  const error = gear.error && failureMessage(gear.error, t, t('scoring.desk.actionError'));

  const counts = countsByStanding(gear.entries);
  const shown = visibleGear(gear.entries, tab, gear.query);

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

        <GearTabs counts={counts} value={tab} onChange={setTab} />

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <RosterNotice truncated={gear.truncated} shown={gear.entries.length} />

        <GearList
          entries={shown}
          loading={gear.loading}
          tab={tab}
          elsewhere={countMatchingQuery(gear.entries, gear.query) - shown.length}
          onShowAll={() => setTab('all')}
          onRecord={gear.recordCheck}
        />
      </div>
    </main>
  );
}

/**
 * The five ways to look at the roster, each carrying its own count.
 *
 * `To check` sits second rather than last because it is the tab the gear table
 * actually works from: it holds everyone nobody has cleared yet.
 */
function GearTabs({
  counts,
  value,
  onChange,
}: {
  counts: GearCounts;
  value: GearTab;
  onChange: (next: GearTab) => void;
}) {
  const { t } = useI18n();

  return (
    <SegmentedTabs
      className="mt-3"
      tabs={[
        { value: 'all' as const, label: `${t('scoring.gear.tabAll')} (${counts.all})` },
        {
          value: 'unchecked' as const,
          label: `${t('scoring.gear.tabUnchecked')} (${counts.unchecked})`,
        },
        { value: 'pass' as const, label: `${t('scoring.gear.tabPass')} (${counts.pass})` },
        {
          value: 'conditional' as const,
          label: `${t('scoring.gear.tabConditional')} (${counts.conditional})`,
        },
        { value: 'fail' as const, label: `${t('scoring.gear.tabFail')} (${counts.fail})` },
      ]}
      value={value}
      onChange={onChange}
      aria-label={t('scoring.gear.tabsLabel')}
    />
  );
}

function GearList({
  entries,
  loading,
  tab,
  elsewhere,
  onShowAll,
  onRecord,
}: {
  entries: GearEntry[];
  loading: boolean;
  tab: GearTab;
  /** People the search matches that this tab is hiding. */
  elsewhere: number;
  onShowAll: () => void;
  onRecord: ReturnType<typeof useGear>['recordCheck'];
}) {
  const { t } = useI18n();

  return (
    <div className="mt-3 flex-1 space-y-2">
      {loading && <p className="text-sm text-muted">{t('scoring.desk.loading')}</p>}
      {!loading && entries.length === 0 && (
        <GearEmptyState tab={tab} elsewhere={elsewhere} onShowAll={onShowAll} />
      )}
      {entries.map((entry) => (
        <GearPersonRow key={entry.person.personId} entry={entry} onRecord={onRecord} />
      ))}
    </div>
  );
}

/** One fighter: their standing, then a line per weapon they are entered in. */
function GearPersonRow({
  entry,
  onRecord,
}: {
  entry: GearEntry;
  onRecord: ReturnType<typeof useGear>['recordCheck'];
}) {
  const { t } = useI18n();
  const { chromeScope } = useScoringTheme();
  const standing = standingFor(entry);

  return (
    <PersonRow
      person={entry.person}
      status={
        <StatusBadge
          semantic={standingSemantic(standing)}
          // The palette is picked in JS, so unlike a semantic class it cannot
          // follow the [data-theme] cascade — it has to be told.
          surface={chromeScope}
        >
          {t(STANDING_KEYS[standing])}
        </StatusBadge>
      }
      actions={null}
    >
      <div className="mt-3 space-y-3 border-t border-border pt-3">
        {entry.weapons.length === 0 ? (
          // `tournaments.weapon` is free text, so a name that fails to resolve
          // to a catalog entry is real and silent. Saying so beats showing a
          // person with no actions and no explanation.
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
  );
}

/**
 * Nothing to show — and, when the tab is why, the way out of it.
 *
 * A volunteer sitting on the Fail tab who types a name and is told "no results"
 * has been failed by a filter they set two minutes ago. The count of matches
 * elsewhere plus one tap to reach them is what stops that.
 */
function GearEmptyState({
  tab,
  elsewhere,
  onShowAll,
}: {
  tab: GearTab;
  elsewhere: number;
  onShowAll: () => void;
}) {
  const { t } = useI18n();

  if (tab !== 'all' && elsewhere > 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center">
        <p className="text-sm text-muted">
          {t('scoring.desk.noResultsInTab', { count: String(elsewhere) })}
        </p>
        <button
          type="button"
          onClick={onShowAll}
          className="mt-3 min-h-[44px] rounded-lg border border-border px-4 text-sm font-semibold"
        >
          {t('scoring.desk.showAllMatches')}
        </button>
      </div>
    );
  }

  return (
    <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
      {t('scoring.desk.noResults')}
    </p>
  );
}
