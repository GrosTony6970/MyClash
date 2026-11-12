'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import type { FightBookEvent } from '@myclash/types';

const INPUT =
  'mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent';
const LABEL = 'block text-sm font-semibold text-foreground';

/** A labelled control. */
export function Field(props: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="mt-3">
      <label htmlFor={props.htmlFor} className={LABEL}>
        {props.label}
      </label>
      {props.children}
    </div>
  );
}

export const inputClass = INPUT;

/** The two ways to ask: at an Event, or on a free date. */
export function KindRadios(props: {
  kind: 'event' | 'free';
  canEvent: boolean;
  onChange: (kind: 'event' | 'free') => void;
}) {
  const { t } = useI18n();
  if (!props.canEvent) return null;
  const radio = (value: 'event' | 'free', label: string) => (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <input
        type="radio"
        name="ask-kind"
        checked={props.kind === value}
        onChange={() => props.onChange(value)}
      />
      {label}
    </label>
  );
  return (
    <fieldset>
      <legend className={LABEL}>{t('publicApp.fightBook.ask.where')}</legend>
      <div className="mt-1 flex flex-wrap gap-4">
        {radio('event', t('publicApp.fightBook.ask.event'))}
        {radio('free', t('publicApp.fightBook.ask.freeDate'))}
      </div>
    </fieldset>
  );
}

/** The Event select and its day select. */
export function EventFields(props: {
  id: string;
  events: FightBookEvent[];
  event: FightBookEvent;
  day: string;
  onEvent: (eventId: string) => void;
  onDay: (day: string) => void;
}) {
  const { t, locale } = useI18n();
  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${day}T00:00:00Z`));
  return (
    <>
      <Field label={t('publicApp.fightBook.ask.event')} htmlFor={`${props.id}-event`}>
        <select
          id={`${props.id}-event`}
          className={INPUT}
          value={props.event.id}
          onChange={(e) => props.onEvent(e.target.value)}
        >
          {props.events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('publicApp.fightBook.ask.day')} htmlFor={`${props.id}-day`}>
        <select
          id={`${props.id}-day`}
          className={INPUT}
          value={props.day}
          onChange={(e) => props.onDay(e.target.value)}
        >
          {props.event.days.map((day) => (
            <option key={day} value={day}>
              {dayLabel(day)}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

/** The weapons as checkboxes; once five are ticked the others wait. */
export function WeaponBoxes(props: {
  catalog: string[];
  picked: string[];
  onToggle: (name: string) => void;
}) {
  const { t } = useI18n();
  return (
    <fieldset className="mt-3">
      <legend className={LABEL}>{t('publicApp.fightBook.ask.weapons')}</legend>
      <div className="mt-1 grid grid-cols-2 gap-2">
        {props.catalog.map((name) => {
          const on = props.picked.includes(name);
          return (
            <label key={name} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={on}
                disabled={!on && props.picked.length >= 5}
                onChange={() => props.onToggle(name)}
              />
              {name}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
