'use client';

import { localeToBcp47 } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';
import { Time24Input } from '@/components/Time24Input';
import { blankLine, type SessionLine } from './session-edits';
import { endFromStartDuration } from './workshop-session-times';

const FIELD =
  'w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent';

interface Props {
  lines: SessionLine[];
  onChange: (lines: SessionLine[]) => void;
  /** The Event's days; a free date field when it has none. */
  days: string[];
  venues: Array<{ id: string; name: string }>;
  /** The Workshop's venue: a new line takes it (ruling 525). */
  workshopVenueId: string;
  /** The Workshop's length: a start fills the end from it. */
  durationMinutes: number | null;
}

/**
 * The Workshop form's sessions (operator rulings 515, 524, 525): one line per session, with its
 * day, start, end and venue; "Add a session"; a remove button per line. The room inside a venue
 * is the board's: a line keeps the room its session has, unless its venue changes.
 */
export function WorkshopSessionsField({
  lines,
  onChange,
  days,
  venues,
  workshopVenueId,
  durationMinutes,
}: Props) {
  const { t, locale } = useI18n();
  const set = (index: number, patch: Partial<SessionLine>) =>
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  // A start fills the end from the Workshop's length, as the single field did.
  const setStart = (index: number, start: string) => {
    const end = endFromStartDuration(start, durationMinutes);
    set(index, end ? { start, end } : { start });
  };
  const dayLabel = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(localeToBcp47(locale), {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC',
    });

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 block text-xs font-medium text-foreground-secondary">
        {t('organizer.workshopsPage.sessionsLabel')}
      </legend>
      {lines.map((line, index) => (
        <div
          key={line.id ?? `new-${index}`}
          className="grid grid-cols-[1fr_5rem_5rem_1fr_auto] items-end gap-2"
        >
          {days.length > 0 ? (
            <select
              aria-label={t('organizer.workshopsPage.dayOptionalLabel')}
              value={line.day}
              onChange={(e) => set(index, { day: e.target.value })}
              className={FIELD}
            >
              <option value="">—</option>
              {days.map((d) => (
                <option key={d} value={d}>
                  {dayLabel(d)}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="date"
              aria-label={t('organizer.workshopsPage.dayOptionalLabel')}
              value={line.day}
              onChange={(e) => set(index, { day: e.target.value })}
              className={FIELD}
            />
          )}
          <Time24Input
            value={line.start}
            onChange={(v) => setStart(index, v)}
            aria-label={t('organizer.workshopsPage.startTimeAria')}
          />
          <Time24Input
            value={line.end}
            onChange={(v) => set(index, { end: v })}
            aria-label={t('organizer.workshopsPage.endTimeAria')}
          />
          <select
            aria-label={t('organizer.workshopsPage.sessionVenueLabel')}
            value={line.venueId}
            onChange={(e) => set(index, { venueId: e.target.value })}
            className={FIELD}
          >
            <option value="">{t('organizer.workshopsPage.sessionNoVenue')}</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={t('organizer.workshopsPage.removeSessionAria')}
            onClick={() => onChange(lines.filter((_, i) => i !== index))}
            className="rounded-lg border border-border px-2 py-1.5 text-sm text-muted hover:text-danger"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...lines, blankLine(workshopVenueId)])}
        className="self-start rounded-lg border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:text-foreground"
      >
        {t('organizer.workshopsPage.addSession')}
      </button>
    </fieldset>
  );
}
