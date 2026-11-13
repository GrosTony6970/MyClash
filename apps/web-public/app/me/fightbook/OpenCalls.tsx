'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { Spinner } from '@myclash/ui';
import { ReadFailed } from '@/components/me/ReadFailed';
import type { OpenCallsAtEvent } from '@myclash/types';
import { MyCall, OthersCall, type CallWrites } from './OpenCallCards';
import { PostOpenCall } from './PostOpenCall';
import { useOpenCalls } from './use-open-calls';

function CallList(props: { calls: OpenCallsAtEvent; writes: CallWrites }) {
  const { t } = useI18n();
  const { mine, others } = props.calls;
  if (mine.length + others.length === 0) {
    return <p className="text-sm text-muted">{t('publicApp.fightBook.floor.callsEmpty')}</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {mine.map((call) => (
        <MyCall key={call.id} call={call} writes={props.writes} />
      ))}
      {others.map((call) => (
        <OthersCall key={call.id} call={call} writes={props.writes} />
      ))}
    </ul>
  );
}

/**
 * Today's open calls at one Event (the Event must have an open day: the caller renders this only
 * then). Mine first, with who is in; then the others'; then the form to post one. A pick makes a
 * spar, so it tells the page (`onSent`) and My spars shows it.
 */
export function OpenCalls(props: {
  apiUrl: string;
  eventId: string;
  catalog: string[];
  onSent: () => void;
}) {
  const { t } = useI18n();
  const state = useOpenCalls(props.apiUrl, props.eventId);
  const { calls } = state;
  const writes = {
    inFlight: state.inFlight,
    answer: state.answer,
    takeBack: state.takeBack,
    close: state.close,
    pick: async (id: string, globalPersonId: string) => {
      const ok = await state.pick(id, globalPersonId);
      if (ok) props.onSent();
      return ok;
    },
  };
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-display text-base font-semibold text-foreground">
        {t('publicApp.fightBook.floor.callsTitle')}
      </h3>
      {calls === null ? <Spinner label={t('common.loading')} /> : null}
      {calls === 'failed' ? (
        <ReadFailed title={t('publicApp.fightBook.floor.callsFailed')} onRetry={state.retry} />
      ) : null}
      {calls !== null && calls !== 'failed' ? <CallList calls={calls} writes={writes} /> : null}
      {state.refusal ? (
        <p role="alert" className="text-sm text-danger">
          {state.refusal}
        </p>
      ) : null}
      <PostOpenCall catalog={props.catalog} posting={state.inFlight('post')} onPost={state.post} />
    </section>
  );
}
