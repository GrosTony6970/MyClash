'use client';

/**
 * Common IANA zones an Event can be on. The value it holds now is always an option too, so a zone
 * outside this list (set before, or restored) still shows as itself.
 */
export const COMMON_EVENT_ZONES = [
  'Europe/Paris',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Zurich',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
  'UTC',
] as const;

/** The options for an Event zone picker: the held value first, then the common zones. */
export function eventZoneOptions(value: string): string[] {
  return Array.from(new Set([value, ...COMMON_EVENT_ZONES]));
}

/**
 * The one picker of an Event's zone: the Event hub's settings and the create wizard. The caller
 * labels it (`htmlFor={id}`). Options are IANA names in the one spelling the API stores.
 */
export function EventZoneSelect({
  id,
  value,
  onChange,
  disabled,
  className,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (zone: string) => void;
  disabled?: boolean;
  className: string;
  /** The id of a help line under the picker. */
  describedBy?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    >
      {eventZoneOptions(value).map((zone) => (
        <option key={zone} value={zone}>
          {zone}
        </option>
      ))}
    </select>
  );
}
