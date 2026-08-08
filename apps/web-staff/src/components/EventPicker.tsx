'use client';

import { useState } from 'react';
import { SegmentedTabs } from '@myclash/ui';
import { useI18n } from '../i18n/I18nProvider';
import { useRememberedEvent } from '../lib/last-event';
import {
  defaultPickerTab,
  partitionPickerEvents,
  type PickerEvent,
  type PickerTab,
} from './picker-events';

export type { PickerEvent } from './picker-events';

interface Props {
  events: PickerEvent[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (event: PickerEvent) => void;
}

// Literal keys, never a template. A computed t() key is invisible to
// t-key-references.test.ts, so the French string would ship missing and no gate
// would notice.
const STATUS_KEYS: Record<string, string> = {
  draft: 'scoring.login.picker.statusDraft',
  published: 'scoring.login.picker.statusPublished',
  running: 'scoring.login.picker.statusRunning',
};

/**
 * Pick the event before the credentials.
 *
 * This ordering is forced, not stylistic: staff usernames are unique per EVENT
 * (`idx_event_staff_accounts_event_username`), so "marie" means nothing until
 * an event is chosen. Putting the username first would ask for an answer that
 * cannot be checked yet.
 */
export function EventPicker({ events, loading, selectedId, onSelect }: Props) {
  const { t } = useI18n();
  const remembered = useRememberedEvent();
  const { live, upcoming } = partitionPickerEvents(events);

  // `null` means "untouched, follow the data"; a tap takes over from there.
  // The same shape the login page uses for its link prefills, and for the same
  // reason: a useState initializer would run on the FIRST render, when the
  // fetch has not landed and both lists are empty, pinning the tab to Upcoming
  // for the rest of the session even at a live event. Deriving it each render
  // lets the default follow the data in without an effect.
  const [tabEdit, setTabEdit] = useState<PickerTab | null>(null);
  const tab = tabEdit ?? defaultPickerTab({ live, upcoming });
  const shown = tab === 'live' ? live : upcoming;

  if (loading) {
    return <p className="text-sm text-muted">{t('scoring.login.picker.loading')}</p>;
  }
  if (events.length === 0) {
    return <p className="text-sm text-muted">{t('scoring.login.picker.empty')}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <SegmentedTabs
        tabs={[
          { value: 'live' as const, label: `${t('scoring.login.picker.live')} (${live.length})` },
          {
            value: 'upcoming' as const,
            label: `${t('scoring.login.picker.upcoming')} (${upcoming.length})`,
          },
        ]}
        value={tab}
        onChange={setTabEdit}
        aria-label={t('scoring.login.picker.tabsLabel')}
      />
      <EventList
        events={shown}
        selectedId={selectedId}
        rememberedId={remembered?.id ?? null}
        onSelect={onSelect}
      />
    </div>
  );
}

function EventList({
  events,
  selectedId,
  rememberedId,
  onSelect,
}: {
  events: PickerEvent[];
  selectedId: string | null;
  rememberedId: string | null;
  onSelect: (event: PickerEvent) => void;
}) {
  const { t } = useI18n();
  if (events.length === 0) {
    return <p className="text-sm text-muted">{t('scoring.login.picker.emptyTab')}</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {events.map((event) => (
        <li key={event.id}>
          <EventRow
            event={event}
            selected={event.id === selectedId}
            remembered={rememberedId === event.id}
            onSelect={onSelect}
          />
        </li>
      ))}
    </ul>
  );
}

function EventRow({
  event,
  selected,
  remembered,
  onSelect,
}: {
  event: PickerEvent;
  selected: boolean;
  remembered: boolean;
  onSelect: (event: PickerEvent) => void;
}) {
  const { t } = useI18n();

  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      aria-pressed={selected}
      className={[
        'w-full rounded-lg border px-4 py-3 text-left transition-colors',
        // 44px+ target: this is tapped one-handed by someone standing up.
        'min-h-[56px] [touch-action:manipulation]',
        selected ? 'border-accent bg-accent/10' : 'border-border bg-surface hover:bg-surface/80',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-semibold text-foreground">{event.name}</span>
        {remembered && (
          <span className="shrink-0 text-xs font-semibold text-accent">
            {t('scoring.login.picker.lastUsed')}
          </span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>{t(STATUS_KEYS[event.status] ?? 'scoring.login.picker.statusPublished')}</span>
        <span>{event.startDate ?? t('scoring.login.picker.noDate')}</span>
        <KindBadge kind={event.kind} />
        {event.status === 'draft' && (
          <Badge tone="warning">{t('scoring.login.picker.badgeDraft')}</Badge>
        )}
      </div>
    </button>
  );
}

/**
 * Test and club events are BADGED, not hidden.
 *
 * They have to be reachable — a dry run is exactly what a volunteer is handed a
 * tablet for — but a volunteer who signs into the wrong one should find out
 * here, on the login screen, and not after checking in ten fighters to a
 * rehearsal. `standard` gets no badge: it is the unremarkable case.
 */
function KindBadge({ kind }: { kind: string }) {
  const { t } = useI18n();
  if (kind === 'test') return <Badge tone="danger">{t('scoring.login.picker.badgeTest')}</Badge>;
  if (kind === 'club') return <Badge tone="muted">{t('scoring.login.picker.badgeClub')}</Badge>;
  return null;
}

function Badge({ tone, children }: { tone: 'danger' | 'warning' | 'muted'; children: string }) {
  const toneClass =
    tone === 'danger'
      ? 'border-danger text-danger'
      : tone === 'warning'
        ? 'border-warning text-warning'
        : 'border-border text-muted';
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide ${toneClass}`}
    >
      {children}
    </span>
  );
}
