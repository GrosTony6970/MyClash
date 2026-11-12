'use client';

import { useEffect, useId, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import type { FightBookEvent, FindCard } from '@myclash/types';
import { Spinner } from '@myclash/ui';
import { Field, inputClass } from '@/components/fightbook/AskSparFields';
import { ReadFailed } from '@/components/me/ReadFailed';
import {
  readFightBookEvents,
  readFindAtEvent,
  readWeaponCatalog,
} from '@/lib/fightbook/read-fightbook';
import { signInAgainHere } from '@/lib/sign-in-return';
import { AllOfFightBook } from './AllOfFightBook';
import { FindCards } from './FindCards';

type Weapon = { id: string; name: string };
type Setup =
  | { status: 'loading' | 'failed' }
  | { status: 'ready'; events: FightBookEvent[]; catalog: Weapon[] };

/** My Events and the weapon catalog, read together; either failing fails both. */
function useFindSetup(apiUrl: string) {
  const [setup, setSetup] = useState<Setup>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      readFightBookEvents(apiUrl, controller.signal),
      readWeaponCatalog(apiUrl, controller.signal),
    ]).then(([events, catalog]) => {
      if (controller.signal.aborted || events.kind === 'aborted' || catalog.kind === 'aborted') {
        return;
      }
      if (events.kind === 'signin' || catalog.kind === 'signin') return signInAgainHere();
      if (events.kind !== 'data' || catalog.kind !== 'data') return setSetup({ status: 'failed' });
      setSetup({ status: 'ready', events: events.data, catalog: catalog.data });
    });
    return () => controller.abort();
  }, [apiUrl, attempt]);
  const retry = () => {
    setSetup({ status: 'loading' });
    setAttempt((n) => n + 1);
  };
  return { setup, retry };
}

/**
 * The FightBook users at one Event, for one weapon. An answer is kept with the Event and weapon it
 * answers, and a switch aborts the read for the old pair, so an older answer never shows under a
 * newer heading. `null` while reading.
 */
const fightersKey = (eventId: string, weapon: string) => `${eventId}|${weapon}`;

function useEventFighters(apiUrl: string, eventId: string, weapon: string) {
  const key = fightersKey(eventId, weapon);
  const [answer, setAnswer] = useState<{ key: string; cards: FindCard[] | 'failed' } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void readFindAtEvent(apiUrl, eventId, weapon, controller.signal).then((read) => {
      if (controller.signal.aborted || read.kind === 'aborted') return;
      if (read.kind === 'signin') return signInAgainHere();
      setAnswer({
        key: fightersKey(eventId, weapon),
        cards: read.kind === 'data' ? read.data : 'failed',
      });
    });
    return () => controller.abort();
  }, [apiUrl, eventId, weapon, attempt]);
  const retry = () => {
    setAnswer(null);
    setAttempt((n) => n + 1);
  };
  return { cards: answer?.key === key ? answer.cards : null, retry };
}

/**
 * The Event block (design "Current Event"): the Event running today; a picker when several run
 * today (the first by day, then name, as `me/fightbook/events` orders them); none today, the
 * soonest upcoming; at no Event, no block at all.
 */
function EventBlock(props: {
  events: FightBookEvent[];
  weapon: string;
  apiUrl: string;
  onSent: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const today = props.events.filter((e) => e.today !== null);
  const [picked, setPicked] = useState<string | null>(null);
  const event = today.find((e) => e.id === picked) ?? today[0] ?? props.events[0];
  if (!event) return null;
  return (
    <section className="flex flex-col gap-3">
      {today.length > 1 ? (
        <Field label={t('publicApp.fightBook.find.event')} htmlFor={`${id}-event`}>
          <select
            id={`${id}-event`}
            className={inputClass}
            value={event.id}
            onChange={(e) => setPicked(e.target.value)}
          >
            {today.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <h2 className="font-display text-lg font-semibold text-foreground">
        {t('publicApp.fightBook.find.atEvent', { event: event.name })}
      </h2>
      <EventFighters
        eventId={event.id}
        weapon={props.weapon}
        apiUrl={props.apiUrl}
        onSent={props.onSent}
      />
    </section>
  );
}

function EventFighters(props: {
  eventId: string;
  weapon: string;
  apiUrl: string;
  onSent: () => void;
}) {
  const { t } = useI18n();
  const { cards, retry } = useEventFighters(props.apiUrl, props.eventId, props.weapon);
  if (cards === null) return <Spinner label={t('common.loading')} />;
  if (cards === 'failed') {
    return <ReadFailed title={t('publicApp.fightBook.find.eventFailed')} onRetry={retry} />;
  }
  if (cards.length === 0) {
    return <p className="text-sm text-muted">{t('publicApp.fightBook.find.eventEmpty')}</p>;
  }
  return (
    <FindCards cards={cards} eventId={props.eventId} apiUrl={props.apiUrl} onSent={props.onSent} />
  );
}

function WeaponSelect(props: { catalog: Weapon[]; value: string; onChange: (id: string) => void }) {
  const { t } = useI18n();
  const id = useId();
  return (
    <Field label={t('publicApp.fightBook.find.weapon')} htmlFor={`${id}-weapon`}>
      <select
        id={`${id}-weapon`}
        className={inputClass}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      >
        <option value="">{t('publicApp.fightBook.find.anyWeapon')}</option>
        {props.catalog.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

/**
 * The Find a partner tab (`?tab=find`): the weapon filter, which narrows both lists; the FightBook
 * users at my Event; then All of FightBook. An ask sent from a card tells the page (`onSent`), so
 * My spars shows the new request.
 */
export function FindTab(props: { apiUrl: string; onSent: () => void }) {
  const { t } = useI18n();
  const { setup, retry } = useFindSetup(props.apiUrl);
  // A catalog weapon id; '' = any weapon.
  const [weapon, setWeapon] = useState('');
  return (
    <div className="flex flex-col gap-6">
      {setup.status === 'loading' ? <Spinner label={t('common.loading')} /> : null}
      {setup.status === 'failed' ? (
        <ReadFailed title={t('publicApp.fightBook.find.loadFailed')} onRetry={retry} />
      ) : null}
      {setup.status === 'ready' ? (
        <>
          <WeaponSelect catalog={setup.catalog} value={weapon} onChange={setWeapon} />
          <EventBlock
            events={setup.events}
            weapon={weapon}
            apiUrl={props.apiUrl}
            onSent={props.onSent}
          />
        </>
      ) : null}
      <AllOfFightBook apiUrl={props.apiUrl} weapon={weapon} onSent={props.onSent} />
    </div>
  );
}
