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
  const { t } = useI18n();
  const set = (index: number, patch: Partial<SessionLine>) =>
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 block text-xs font-medium text-foreground-secondary">
        {t('organizer.workshopsPage.sessionsLabel')}
      </legend>
      {lines.map((line, index) => (
        <SessionLineRow
          key={line.id ?? `new-${index}`}
          line={line}
          onPatch={(patch) => set(index, patch)}
          onRemove={() => onChange(lines.filter((_, i) => i !== index))}
          days={days}
          venues={venues}
          durationMinutes={durationMinutes}
        />
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

/** One session: its day, start, end and venue, and a remove button. */
function SessionLineRow({
  line,
  onPatch,
  onRemove,
  days,
  venues,
  durationMinutes,
}: Pick<Props, 'days' | 'venues' | 'durationMinutes'> & {
  line: SessionLine;
  onPatch: (patch: Partial<SessionLine>) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  // A start fills the end from the Workshop's length, as the single field did.
  const setStart = (start: string) => {
    const end = endFromStartDuration(start, durationMinutes);
    onPatch(end ? { start, end } : { start });
  };
  return (
    <div className="grid grid-cols-[1fr_5rem_5rem_1fr_auto] items-end gap-2">
      <SessionDayField value={line.day} days={days} onChange={(day) => onPatch({ day })} />
      <Time24Input
        value={line.start}
        onChange={setStart}
        aria-label={t('organizer.workshopsPage.startTimeAria')}
      />
      <Time24Input
        value={line.end}
        onChange={(v) => onPatch({ end: v })}
        aria-label={t('organizer.workshopsPage.endTimeAria')}
      />
      <SessionVenueField
        value={line.venueId}
        venues={venues}
        onChange={(venueId) => onPatch({ venueId })}
      />
      <button
        type="button"
        aria-label={t('organizer.workshopsPage.removeSessionAria')}
        onClick={onRemove}
        className="rounded-lg border border-border px-2 py-1.5 text-sm text-muted hover:text-danger"
      >
        ✕
      </button>
    </div>
  );
}

/** A session's venue, or none. */
function SessionVenueField({
  value,
  venues,
  onChange,
}: {
  value: string;
  venues: Props['venues'];
  onChange: (venueId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <select
      aria-label={t('organizer.workshopsPage.sessionVenueLabel')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={FIELD}
    >
      <option value="">{t('organizer.workshopsPage.sessionNoVenue')}</option>
      {venues.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name}
        </option>
      ))}
    </select>
  );
}

/** A session's day: one of the Event's days, or a free date when the Event has none. */
function SessionDayField({
  value,
  days,
  onChange,
}: {
  value: string;
  days: string[];
  onChange: (day: string) => void;
}) {
  const { t, locale } = useI18n();
  const label = t('organizer.workshopsPage.dayOptionalLabel');
  if (days.length === 0) {
    return (
      <input
        type="date"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD}
      />
    );
  }
  const dayLabel = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(localeToBcp47(locale), {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC',
    });
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={FIELD}
    >
      <option value="">—</option>
      {days.map((d) => (
        <option key={d} value={d}>
          {dayLabel(d)}
        </option>
      ))}
    </select>
  );
}
