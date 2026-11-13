'use client';

import { useI18n } from '@myclash/next-i18n/client';
import type { MyOpenCall, OpenCallView } from '@myclash/types';
import { Button } from '@myclash/ui';

const CARD = 'flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-sm';

export type CallWrites = {
  inFlight: (id: string) => boolean;
  answer: (id: string) => Promise<boolean>;
  takeBack: (id: string) => Promise<boolean>;
  pick: (id: string, globalPersonId: string) => Promise<boolean>;
  close: (id: string) => Promise<boolean>;
};

/** Someone else's call: when, which weapons, and my face on it (ruling 712: no names, no count). */
export function OthersCall(props: { call: OpenCallView; writes: CallWrites }) {
  const { t } = useI18n();
  const { call, writes } = props;
  const name = call.poster.name || t('publicApp.fightBook.unknownFighter');
  const busy = writes.inFlight(call.id);
  return (
    <li data-open-call className={CARD}>
      <p className="text-sm font-semibold text-foreground">
        {t('publicApp.fightBook.floor.callAt', {
          weapons: call.weapons.join(', '),
          time: call.time,
        })}
      </p>
      <p className="text-xs text-muted">{t('publicApp.fightBook.floor.postedBy', { name })}</p>
      {call.myAnswer === 'none' && call.open ? (
        <Button
          type="button"
          className="min-h-11 self-start"
          disabled={busy}
          onClick={() => void writes.answer(call.id)}
        >
          {t('publicApp.fightBook.floor.imIn')}
        </Button>
      ) : null}
      {call.myAnswer === 'in' ? (
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 self-start"
          disabled={busy}
          onClick={() => void writes.takeBack(call.id)}
        >
          {t('publicApp.fightBook.floor.takeBack')}
        </Button>
      ) : null}
      {call.myAnswer === 'picked' ? (
        <p className="text-sm font-semibold text-success">
          {t('publicApp.fightBook.floor.pickedYou')}
        </p>
      ) : null}
      {call.myAnswer === 'not_this_time' ? (
        <p className="text-sm text-muted">{t('publicApp.fightBook.floor.notThisTime')}</p>
      ) : null}
    </li>
  );
}

/** Who is in on my open call, each with "Pick". */
function Answers(props: { call: MyOpenCall; writes: CallWrites }) {
  const { t } = useI18n();
  const { call, writes } = props;
  return (
    <>
      <p className="text-xs font-semibold text-muted">{t('publicApp.fightBook.floor.answers')}</p>
      {call.answers.length === 0 ? (
        <p className="text-sm text-muted">{t('publicApp.fightBook.floor.noAnswers')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {call.answers.map((fighter) => (
            <li key={fighter.globalPersonId} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {fighter.name || t('publicApp.fightBook.unknownFighter')}
              </span>
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                disabled={writes.inFlight(call.id)}
                onClick={() => void writes.pick(call.id, fighter.globalPersonId)}
              >
                {t('publicApp.fightBook.floor.pick')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function MyCallState(props: { call: MyOpenCall; writes: CallWrites }) {
  const { t } = useI18n();
  const { call, writes } = props;
  if (call.state === 'picked') {
    const name = call.picked?.name || t('publicApp.fightBook.unknownFighter');
    return (
      <p className="text-sm font-semibold text-foreground">
        {t('publicApp.fightBook.floor.pickedFighter', { name })}
      </p>
    );
  }
  if (call.state === 'closed') {
    return <p className="text-sm text-muted">{t('publicApp.fightBook.floor.closed')}</p>;
  }
  return (
    <>
      <Answers call={call} writes={writes} />
      <Button
        type="button"
        variant="ghost"
        className="min-h-11 self-start"
        disabled={writes.inFlight(call.id)}
        onClick={() => void writes.close(call.id)}
      >
        {t('publicApp.fightBook.floor.close')}
      </Button>
    </>
  );
}

/** My own call: who is in (open calls only), with "Pick" on each and "Close" on the call. */
export function MyCall(props: { call: MyOpenCall; writes: CallWrites }) {
  const { t } = useI18n();
  return (
    <li data-my-open-call className={CARD}>
      <p className="text-sm font-semibold text-foreground">
        {t('publicApp.fightBook.floor.callAt', {
          weapons: props.call.weapons.join(', '),
          time: props.call.time,
        })}
      </p>
      <MyCallState call={props.call} writes={props.writes} />
    </li>
  );
}
