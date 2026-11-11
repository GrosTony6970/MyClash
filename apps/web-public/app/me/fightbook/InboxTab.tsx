'use client';

import { useId, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import type { IncomingSparRequest, SparFighter } from '@myclash/types';
import { Button, EmptyState, Modal, useConfirm } from '@myclash/ui';
import { writeFightBook } from '@/lib/fightbook/read-fightbook';
import { sparRefusalKey } from '@/lib/fightbook/refusal';
import { SparCard } from './SparCard';

export type AnswerBody = { answer: 'yes' | 'no'; comment?: string; showComment?: boolean };

/**
 * What the Inbox's buttons do. A won answer, and one lost to a request no longer open, take the
 * card out of the list from the write's own answer: no re-read. Any refusal is said.
 */
function useInboxActions(
  apiUrl: string,
  onAnswered: (request: IncomingSparRequest, status: string | null) => void,
  onBlocked: (asker: SparFighter) => void,
) {
  const { t } = useI18n();
  const { confirm, confirmDialog } = useConfirm();
  const [refusal, setRefusal] = useState<string | null>(null);
  const answer = async (request: IncomingSparRequest, body: AnswerBody) => {
    setRefusal(null);
    const path = `/api/v1/me/fightbook/requests/${request.id}/answer`;
    const res = await writeFightBook<{ status: string }>(apiUrl, path, 'POST', body);
    if (res.ok) return onAnswered(request, res.data.status);
    if (res.code === 'not_open') onAnswered(request, null);
    setRefusal(t(sparRefusalKey(res.code)));
  };
  const block = async (asker: SparFighter) => {
    const sure = await confirm({
      title: t('publicApp.fightBook.inbox.blockTitle'),
      description: t('publicApp.fightBook.inbox.blockDescription'),
      confirmLabel: t('publicApp.fightBook.inbox.blockConfirm'),
      cancelLabel: t('publicApp.fightBook.inbox.cancel'),
      danger: true,
    });
    if (!sure) return;
    setRefusal(null);
    const body = { globalPersonId: asker.globalPersonId };
    const res = await writeFightBook(apiUrl, '/api/v1/me/fightbook/blocks', 'POST', body);
    if (res.ok) onBlocked(asker);
    else setRefusal(t(sparRefusalKey(res.code)));
  };
  return { answer, block, refusal, confirmDialog };
}

/** "Not this time", with a comment that stays private unless she ticks "let them see it". */
function DeclineDialog(props: { onSend: (body: AnswerBody) => void; onClose: () => void }) {
  const { t } = useI18n();
  const id = useId();
  const [comment, setComment] = useState('');
  const [show, setShow] = useState(false);
  const send = () =>
    props.onSend({ answer: 'no', comment: comment.trim() || undefined, showComment: show });
  const footer = (
    <>
      <Button type="button" variant="ghost" onClick={props.onClose}>
        {t('publicApp.fightBook.inbox.cancel')}
      </Button>
      <Button type="button" onClick={send}>
        {t('publicApp.fightBook.inbox.noSend')}
      </Button>
    </>
  );
  return (
    <Modal
      open
      onClose={props.onClose}
      title={t('publicApp.fightBook.inbox.noTitle')}
      footer={footer}
    >
      <label htmlFor={id} className="text-sm font-semibold text-foreground">
        {t('publicApp.fightBook.inbox.noComment')}
      </label>
      <textarea
        id={id}
        maxLength={500}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
      />
      <label className="mt-3 flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        {t('publicApp.fightBook.inbox.noShow')}
      </label>
    </Modal>
  );
}

/** One request waiting for my answer, with its three buttons. */
function InboxCard(props: {
  request: IncomingSparRequest;
  onYes: () => void;
  onNo: () => void;
  onBlock: () => void;
}) {
  const { t } = useI18n();
  const { request } = props;
  return (
    <SparCard fighter={request.asker} when={request} message={request.message}>
      <Button type="button" onClick={props.onYes}>
        {t('publicApp.fightBook.inbox.yes')}
      </Button>
      <Button type="button" variant="secondary" onClick={props.onNo}>
        {t('publicApp.fightBook.inbox.no')}
      </Button>
      <Button type="button" variant="ghost" onClick={props.onBlock}>
        {t('publicApp.fightBook.inbox.block')}
      </Button>
    </SparCard>
  );
}

/** Requests waiting for my answer: Yes, Not this time, Block. */
export function InboxTab(props: {
  apiUrl: string;
  inbox: IncomingSparRequest[];
  onAnswered: (request: IncomingSparRequest, status: string | null) => void;
  onBlocked: (asker: SparFighter) => void;
}) {
  const { t } = useI18n();
  const actions = useInboxActions(props.apiUrl, props.onAnswered, props.onBlocked);
  const [declining, setDeclining] = useState<IncomingSparRequest | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {actions.refusal ? (
        <p role="alert" className="text-sm text-danger">
          {actions.refusal}
        </p>
      ) : null}
      {props.inbox.length === 0 ? (
        <EmptyState
          title={t('publicApp.fightBook.inbox.empty')}
          description={t('publicApp.fightBook.inbox.emptyDescription')}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {props.inbox.map((request) => (
            <InboxCard
              key={request.id}
              request={request}
              onYes={() => void actions.answer(request, { answer: 'yes' })}
              onNo={() => setDeclining(request)}
              onBlock={() => void actions.block(request.asker)}
            />
          ))}
        </ul>
      )}
      {declining ? (
        <DeclineDialog
          onClose={() => setDeclining(null)}
          onSend={(body) => {
            setDeclining(null);
            void actions.answer(declining, body);
          }}
        />
      ) : null}
      {actions.confirmDialog}
    </div>
  );
}
