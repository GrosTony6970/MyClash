'use client';

import { useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import type { AgreedSpar, MySpars, SentSparRequest } from '@myclash/types';
import { Button, EmptyState, usePrompt } from '@myclash/ui';
import { writeFightBook } from '@/lib/fightbook/read-fightbook';
import { sparRefusalKey } from '@/lib/fightbook/refusal';
import { useDayLabel } from '@/components/fightbook/day-label';
import { SparCard } from './SparCard';
import { useInFlight } from './use-in-flight';

/** The spars of each day, in day order (the list arrives sorted by day, then time). */
function byDay(spars: AgreedSpar[]): Array<[string, AgreedSpar[]]> {
  const days = new Map<string, AgreedSpar[]>();
  for (const spar of spars) days.set(spar.day, [...(days.get(spar.day) ?? []), spar]);
  return [...days.entries()];
}

function AgreedNote({ spar }: { spar: AgreedSpar }) {
  const { t } = useI18n();
  if (spar.status === 'agreed') {
    return (
      <p className="text-muted">
        {spar.iAsked
          ? t('publicApp.fightBook.spars.youAsked')
          : t('publicApp.fightBook.spars.theyAsked')}
      </p>
    );
  }
  return (
    <>
      <p className="font-semibold text-danger">{t('publicApp.fightBook.spars.cancelled')}</p>
      <p className="text-muted">
        {spar.cancelledByMe
          ? t('publicApp.fightBook.spars.cancelledByYou')
          : t('publicApp.fightBook.spars.cancelledByThem')}
      </p>
      {spar.cancelMessage ? <p className="italic text-muted">{spar.cancelMessage}</p> : null}
    </>
  );
}

function SentNote({ request }: { request: SentSparRequest }) {
  const { t } = useI18n();
  if (request.status === 'pending') {
    return <p className="text-muted">{t('publicApp.fightBook.spars.waiting')}</p>;
  }
  return (
    <>
      <p className="font-semibold text-foreground">{t('publicApp.fightBook.spars.notThisTime')}</p>
      {request.comment ? <p className="italic text-muted">{request.comment}</p> : null}
    </>
  );
}

/**
 * Cancel and withdraw: each one write, its refusal said; a won write patches the list. A write
 * lost to a request no longer open reads the page again (`onStale`): the spar may be cancelled
 * already, the request a spar now. A card's buttons are disabled while its write runs.
 */
function useSparActions(
  apiUrl: string,
  onCancelled: (id: string, message: string | null) => void,
  onWithdrawn: (id: string) => void,
  onStale: () => void,
) {
  const { t } = useI18n();
  const { prompt, promptDialog } = usePrompt();
  const { inFlight, run } = useInFlight();
  const [refusal, setRefusal] = useState<string | null>(null);
  const refused = (code: string | null) => {
    if (code === 'not_open') onStale();
    setRefusal(t(sparRefusalKey(code)));
  };
  const cancel = async (spar: AgreedSpar) => {
    const message = await prompt({
      title: t('publicApp.fightBook.spars.cancelTitle'),
      description: t('publicApp.fightBook.spars.cancelDescription'),
      placeholder: t('publicApp.fightBook.spars.cancelPlaceholder'),
      confirmLabel: t('publicApp.fightBook.spars.cancelConfirm'),
      cancelLabel: t('publicApp.fightBook.spars.keep'),
      allowEmpty: true,
      multiline: true,
      danger: true,
    });
    if (message === null) return;
    setRefusal(null);
    const body = message.trim() ? { message: message.trim() } : {};
    const path = `/api/v1/me/fightbook/requests/${spar.id}/cancel`;
    const res = await run(spar.id, () => writeFightBook(apiUrl, path, 'POST', body));
    if (res.ok) onCancelled(spar.id, message.trim() || null);
    else refused(res.code);
  };
  const withdraw = async (request: SentSparRequest) => {
    setRefusal(null);
    const path = `/api/v1/me/fightbook/requests/${request.id}/withdraw`;
    const res = await run(request.id, () => writeFightBook(apiUrl, path, 'POST'));
    if (res.ok) onWithdrawn(request.id);
    else refused(res.code);
  };
  return { cancel, withdraw, inFlight, refusal, promptDialog };
}

/** My agreed spars, by day, then the requests I sent and their answer so far. */
export function MySparsTab(props: {
  apiUrl: string;
  spars: MySpars;
  onCancelled: (id: string, message: string | null) => void;
  onWithdrawn: (id: string) => void;
  onStale: () => void;
}) {
  const { t } = useI18n();
  const actions = useSparActions(props.apiUrl, props.onCancelled, props.onWithdrawn, props.onStale);
  const { spars, sent } = props.spars;
  if (spars.length === 0 && sent.length === 0) {
    return (
      <EmptyState
        title={t('publicApp.fightBook.spars.empty')}
        description={t('publicApp.fightBook.spars.emptyDescription')}
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {actions.refusal ? (
        <p role="alert" className="text-sm text-danger">
          {actions.refusal}
        </p>
      ) : null}
      <SparDays
        spars={spars}
        busy={actions.inFlight}
        onCancel={(spar) => void actions.cancel(spar)}
      />
      {sent.length > 0 ? (
        <SentList
          sent={sent}
          busy={actions.inFlight}
          onWithdraw={(r) => void actions.withdraw(r)}
        />
      ) : null}
      {actions.promptDialog}
    </div>
  );
}

/** My spars, a heading per day. */
function SparDays(props: {
  spars: AgreedSpar[];
  busy: (id: string) => boolean;
  onCancel: (spar: AgreedSpar) => void;
}) {
  const { t } = useI18n();
  const dayLabel = useDayLabel();
  return byDay(props.spars).map(([day, ofDay]) => (
    <section key={day}>
      <h3 data-spar-day className="mb-2 text-sm font-semibold text-foreground">
        {dayLabel(day)}
      </h3>
      <ul className="flex flex-col gap-3">
        {ofDay.map((spar) => (
          <SparCard
            key={spar.id}
            fighter={spar.partner}
            when={spar}
            message={spar.message}
            note={<AgreedNote spar={spar} />}
          >
            {spar.status === 'agreed' ? (
              <Button
                type="button"
                variant="outline"
                disabled={props.busy(spar.id)}
                onClick={() => props.onCancel(spar)}
              >
                {t('publicApp.fightBook.spars.cancel')}
              </Button>
            ) : null}
          </SparCard>
        ))}
      </ul>
    </section>
  ));
}

function SentList(props: {
  sent: SentSparRequest[];
  busy: (id: string) => boolean;
  onWithdraw: (r: SentSparRequest) => void;
}) {
  const { t } = useI18n();
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-foreground">
        {t('publicApp.fightBook.spars.sentHeading')}
      </h3>
      <ul className="flex flex-col gap-3">
        {props.sent.map((request) => (
          <SparCard
            key={request.id}
            fighter={request.receiver}
            when={request}
            message={request.message}
            note={<SentNote request={request} />}
          >
            {request.status === 'pending' ? (
              <Button
                type="button"
                variant="outline"
                disabled={props.busy(request.id)}
                onClick={() => props.onWithdraw(request)}
              >
                {t('publicApp.fightBook.spars.withdraw')}
              </Button>
            ) : null}
          </SparCard>
        ))}
      </ul>
    </section>
  );
}
