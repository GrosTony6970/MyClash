'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@myclash/next-i18n/client';
import type { FightBookEvent } from '@myclash/types';
import { Button, Modal } from '@myclash/ui';
import {
  readFightBookEvents,
  readWeaponCatalog,
  writeFightBook,
} from '@/lib/fightbook/read-fightbook';
import { sparRefusalKey } from '@/lib/fightbook/refusal';
import { EventFields, Field, inputClass, KindRadios, WeaponBoxes } from './AskSparFields';

export interface AskSparDialogProps {
  receiverGlobalPersonId: string;
  name: string;
  /** The Event the caller is looking at; preselected when the caller is on it. */
  eventId?: string;
  apiUrl: string;
  onClose: () => void;
  onSent?: () => void;
}

/** Today in the browser's zone, `YYYY-MM-DD`. */
function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** What the dialog needs from the API: my Events and the weapon catalog. `null` = still reading. */
function useAskChoices(apiUrl: string) {
  const [events, setEvents] = useState<FightBookEvent[] | null>(null);
  const [catalog, setCatalog] = useState<string[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void readFightBookEvents(apiUrl, controller.signal).then((r) => {
      if (r.kind !== 'aborted') setEvents(r.kind === 'data' ? r.data : []);
    });
    void readWeaponCatalog(apiUrl, controller.signal).then((r) => {
      if (r.kind !== 'aborted') setCatalog(r.kind === 'data' ? r.data.map((w) => w.name) : []);
    });
    return () => controller.abort();
  }, [apiUrl]);
  return { events, catalog };
}

/** The form's values. The Event, its day and the kind are the caller's pick, else a default. */
function useAskValues(events: FightBookEvent[], preferredEventId: string | undefined) {
  const [pickedKind, setKind] = useState<'event' | 'free' | null>(null);
  const [pickedEventId, setEventId] = useState<string | null>(null);
  const [pickedDay, setDay] = useState<string | null>(null);
  const [date, setDate] = useState(localToday);
  const [place, setPlace] = useState('');
  const [weapons, setWeapons] = useState<string[]>([]);
  const [time, setTime] = useState('');
  const [message, setMessage] = useState('');
  const fallback = events.find((e) => e.id === preferredEventId) ?? events[0];
  const event = events.find((e) => e.id === pickedEventId) ?? fallback;
  const kind = event ? (pickedKind ?? 'event') : 'free';
  const day =
    (pickedDay && event?.days.includes(pickedDay) ? pickedDay : null) ??
    event?.today ??
    event?.days[0] ??
    '';
  const toggle = (name: string) =>
    setWeapons((now) => (now.includes(name) ? now.filter((w) => w !== name) : [...now, name]));
  const chooseEvent = (id: string) => {
    setEventId(id);
    setDay(null);
  };
  return {
    kind,
    event,
    day,
    date,
    place,
    weapons,
    time,
    message,
    setKind,
    setDay,
    setDate,
    setPlace,
    setTime,
    setMessage,
    toggle,
    chooseEvent,
  };
}

type AskValues = ReturnType<typeof useAskValues>;

/** The POST body: empty `time` and `message` are left out, an Event spar names no place or zone. */
function askBody(receiverGlobalPersonId: string, v: AskValues, catalog: string[]) {
  const weapons = catalog.filter((w) => v.weapons.includes(w));
  const common = {
    receiverGlobalPersonId,
    weapons,
    ...(v.time ? { time: v.time } : {}),
    ...(v.message.trim() ? { message: v.message.trim() } : {}),
  };
  if (v.kind === 'event' && v.event) {
    return { ...common, kind: 'event', eventId: v.event.id, day: v.day };
  }
  return {
    ...common,
    kind: 'free',
    day: v.date,
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    place: v.place.trim(),
  };
}

/** The sending: one request at a time; a refusal is said and the dialog stays open. */
function useAskSend(props: AskSparDialogProps, v: AskValues, catalog: string[]) {
  const { t } = useI18n();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const send = async () => {
    setSending(true);
    setRefusal(null);
    const body = askBody(props.receiverGlobalPersonId, v, catalog);
    const res = await writeFightBook<{ id: string }>(
      props.apiUrl,
      '/api/v1/me/fightbook/requests',
      'POST',
      body,
    );
    setSending(false);
    if (!res.ok) return setRefusal(t(sparRefusalKey(res.code)));
    setSent(true);
    props.onSent?.();
  };
  return { sending, sent, refusal, send };
}

function FreeDateFields({ id, v }: { id: string; v: AskValues }) {
  const { t } = useI18n();
  return (
    <>
      <Field label={t('publicApp.fightBook.ask.date')} htmlFor={`${id}-date`}>
        <input
          id={`${id}-date`}
          type="date"
          min={localToday()}
          className={inputClass}
          value={v.date}
          onChange={(e) => v.setDate(e.target.value)}
        />
      </Field>
      <Field label={t('publicApp.fightBook.ask.place')} htmlFor={`${id}-place`}>
        <input
          id={`${id}-place`}
          type="text"
          maxLength={200}
          className={inputClass}
          value={v.place}
          onChange={(e) => v.setPlace(e.target.value)}
        />
      </Field>
    </>
  );
}

function AskFields(props: {
  id: string;
  events: FightBookEvent[];
  catalog: string[];
  v: AskValues;
}) {
  const { t } = useI18n();
  const { id, v } = props;
  return (
    <>
      <KindRadios kind={v.kind} canEvent={props.events.length > 0} onChange={v.setKind} />
      {v.kind === 'event' && v.event ? (
        <EventFields
          id={id}
          events={props.events}
          event={v.event}
          day={v.day}
          onEvent={v.chooseEvent}
          onDay={v.setDay}
        />
      ) : (
        <FreeDateFields id={id} v={v} />
      )}
      {props.catalog.length === 0 ? (
        <p className="mt-3 text-sm text-danger">{t('publicApp.fightBook.ask.weaponsFailed')}</p>
      ) : (
        <WeaponBoxes catalog={props.catalog} picked={v.weapons} onToggle={v.toggle} />
      )}
      <Field label={t('publicApp.fightBook.ask.time')} htmlFor={`${id}-time`}>
        <input
          id={`${id}-time`}
          type="time"
          className={inputClass}
          value={v.time}
          onChange={(e) => v.setTime(e.target.value)}
        />
      </Field>
      <Field label={t('publicApp.fightBook.ask.message')} htmlFor={`${id}-message`}>
        <textarea
          id={`${id}-message`}
          maxLength={500}
          className={inputClass}
          value={v.message}
          onChange={(e) => v.setMessage(e.target.value)}
        />
      </Field>
    </>
  );
}

function AskFooter(props: {
  sent: boolean;
  sending: boolean;
  canSend: boolean;
  onClose: () => void;
  onSend: () => void;
}) {
  const { t } = useI18n();
  if (props.sent) {
    return (
      <Button type="button" onClick={props.onClose}>
        {t('publicApp.fightBook.ask.close')}
      </Button>
    );
  }
  return (
    <>
      <Button type="button" variant="ghost" disabled={props.sending} onClick={props.onClose}>
        {t('publicApp.fightBook.ask.cancel')}
      </Button>
      <Button type="button" disabled={!props.canSend || props.sending} onClick={props.onSend}>
        {t('publicApp.fightBook.ask.send')}
      </Button>
    </>
  );
}

/** Ask one fighter for a spar: at an Event, or on a free date. */
export function AskSparDialog(props: AskSparDialogProps) {
  const { t } = useI18n();
  const id = useId();
  const { events, catalog } = useAskChoices(props.apiUrl);
  const v = useAskValues(events ?? [], props.eventId);
  const ready = events !== null && catalog !== null;
  const { sending, sent, refusal, send } = useAskSend(props, v, catalog ?? []);
  const complete =
    v.weapons.length > 0 &&
    (v.kind === 'event' ? v.day !== '' : v.date !== '' && v.place.trim() !== '');
  const footer = (
    <AskFooter
      sent={sent}
      sending={sending}
      canSend={ready && complete}
      onClose={props.onClose}
      onSend={() => void send()}
    />
  );
  return (
    <Modal
      open
      onClose={props.onClose}
      title={t('publicApp.fightBook.ask.title', { name: props.name })}
      size="md"
      busy={sending}
      footer={footer}
    >
      {sent ? (
        <p role="status" className="text-sm text-foreground">
          {t('publicApp.fightBook.ask.sent')}{' '}
          <Link href="/me/fightbook?tab=spars" className="font-semibold text-accent underline">
            {t('publicApp.fightBook.ask.seeSpars')}
          </Link>
        </p>
      ) : ready ? (
        <AskFields id={id} events={events} catalog={catalog} v={v} />
      ) : (
        <p role="status" className="text-sm text-muted">
          {t('publicApp.fightBook.ask.loading')}
        </p>
      )}
      {refusal ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {refusal}
        </p>
      ) : null}
    </Modal>
  );
}
