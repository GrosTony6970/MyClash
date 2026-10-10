'use client';

import { useCallback, useEffect, useState } from 'react';
import { Modal, useConfirm } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import {
  discardQuestion,
  heldBoutLine,
  heldPressLabel,
  heldWaitingLine,
  heldWhoLine,
} from '../lib/held-hit';
import { heldReason } from '../lib/refusal-copy';
import { canSendAgain } from '../offline/can-send-again';
import { getRejected } from '../offline/outbox';
import { kindOf, type ExchangeType, type RejectedEntry } from '../offline/db';
import { waitingBehind } from '../offline/press-queue';
import type { SyncEngine } from '../offline/sync';

/**
 * An exhaustive switch, not `t(\`scoring.exchangeType.${type}\`)`.
 *
 * A template-literal key is invisible to the i18n reference test, which is what
 * keeps EN and FR in step — it would need a manual dynamic-prefix entry, and a
 * new ExchangeType would then ship with no French at all. This way the compiler
 * flags the gap instead.
 */
function exchangeTypeLabel(type: ExchangeType, t: (key: string) => string): string {
  switch (type) {
    case 'clean':
      return t('scoring.quarantine.typeClean');
    case 'afterblow':
      return t('scoring.quarantine.typeAfterblow');
    case 'double':
      return t('scoring.quarantine.typeDouble');
    case 'no_exchange':
      return t('scoring.quarantine.typeNoExchange');
  }
}

/**
 * What a held row is, in one word.
 *
 * The queue carries penalties as well as exchanges now, and a penalty has no
 * `type` — so this row can no longer assume one. A pre-v3 row also has no
 * `kind`; every reader treats that as 'exchange'. A clock press is a third
 * kind, named by its button. No `default`: a fourth kind does not compile.
 */
function entryLabel(entry: RejectedEntry, t: (key: string) => string): string {
  switch (kindOf(entry)) {
    case 'press':
      return heldPressLabel(entry.pressAction, t);
    case 'penalty':
      return t('scoring.quarantine.typePenalty');
    case 'exchange':
      return entry.type ? exchangeTypeLabel(entry.type, t) : t('scoring.quarantine.typeUnknown');
  }
}

/** How many rows of its bout wait behind each held press, by the press's id. */
async function countWaiting(held: RejectedEntry[]): Promise<Map<number, number>> {
  const behind = new Map<number, number>();
  for (const entry of held) {
    if (entry.id === undefined || kindOf(entry) !== 'press') continue;
    behind.set(entry.id, await waitingBehind(entry));
  }
  return behind;
}

/**
 * Loading the held entries and acting on one.
 *
 * Both actions go through the SyncEngine rather than the Dexie store directly,
 * so the network bar's count and this list cannot disagree — the engine's
 * emit() re-derives 'error' from whatever is still held.
 */
function useQuarantineActions(open: boolean, syncEngine: SyncEngine) {
  const { t } = useI18n();
  const { confirm, confirmDialog } = useConfirm();
  const [entries, setEntries] = useState<RejectedEntry[]>([]);
  const [behind, setBehind] = useState<Map<number, number>>(new Map());
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const held = await getRejected();
    const waiting = await countWaiting(held);
    setEntries(held);
    setBehind(waiting);
  }, []);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async read resolves after the store responds
    void load();
    // The list above is read from the store; the bar must say the same.
    void syncEngine.refreshState();
  }, [open, load, syncEngine]);

  async function run(id: number | undefined, action: (id: number) => Promise<unknown>) {
    if (id === undefined) return;
    setBusyId(id);
    try {
      await action(id);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const handleRetry = (entry: RejectedEntry) =>
    run(entry.id, (id) => syncEngine.retryRejectedEntry(id));

  async function handleDiscard(entry: RejectedEntry) {
    if (!(await confirm(discardQuestion(entry, t)))) return;
    await run(entry.id, (id) => syncEngine.discardRejectedEntry(id));
  }

  return { entries, behind, busyId, confirmDialog, handleRetry, handleDiscard };
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Which bout, and who scored: what a held hit is read out from (ruling 243). */
function HeldNames({ entry, t }: { entry: RejectedEntry; t: Translate }) {
  const lines = [heldBoutLine(entry), heldWhoLine(entry, t)].filter((line) => line !== null);
  return lines.map((line) => (
    <p key={line} className="mt-1 text-sm">
      {line}
    </p>
  ));
}

/**
 * Why the row is held: the server's own words, unless the pad knows the
 * refusal by its code. A 400 carries a real message; only 5xx is scrubbed, and
 * a scrubbed one would say so. Under it, for a held press, the rows of its
 * bout that wait behind it.
 */
function HeldReason({
  entry,
  waiting,
  t,
}: {
  entry: RejectedEntry;
  waiting: number;
  t: Translate;
}) {
  const behind = heldWaitingLine(waiting, t);
  return (
    <>
      <p className="mt-1 text-sm text-danger">{heldReason(entry, t)}</p>
      {behind && (
        <p data-testid="quarantine-waiting" className="mt-1 text-sm font-semibold">
          {behind}
        </p>
      )}
    </>
  );
}

/** One held exchange: what it was, when it was refused, and the way out. */
function QuarantineRow({
  entry,
  waiting,
  busy,
  onRetry,
  onDiscard,
  t,
}: {
  entry: RejectedEntry;
  /** Of a held press: the rows of its bout that wait behind it. */
  waiting: number;
  busy: boolean;
  onRetry: () => void;
  onDiscard: () => void;
  t: Translate;
}) {
  return (
    <li data-testid="quarantine-row" className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-bold uppercase tracking-wide">{entryLabel(entry, t)}</span>
        <span className="text-xs text-muted">
          {new Date(entry.rejectedAt).toLocaleTimeString()}
        </span>
      </div>
      <HeldNames entry={entry} t={t} />
      <HeldReason entry={entry} waiting={waiting} t={t} />
      <div className="mt-3 flex gap-2">
        {canSendAgain(entry) && (
          <button
            type="button"
            disabled={busy}
            onClick={onRetry}
            className="min-h-[44px] flex-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {t('scoring.quarantine.retry')}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onDiscard}
          className="min-h-[44px] rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-muted transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
        >
          {t('scoring.quarantine.discard')}
        </button>
      </div>
    </li>
  );
}

/**
 * The operator's view of exchanges the server refused.
 *
 * The store has always held these — `db.ts` calls the table "held for the
 * operator to retry" and the sync bar has always counted them — but there was
 * no way to SEE one. So the bar reported "2 hits refused" and the only
 * available action was retry-everything, with no way to learn what had been
 * refused or why. This is the missing half.
 *
 * Every action goes through the SyncEngine, never the Dexie store directly, so
 * the bar's count and this list cannot disagree.
 */
export function QuarantineInbox({
  open,
  onClose,
  syncEngine,
}: {
  open: boolean;
  onClose: () => void;
  syncEngine: SyncEngine;
}) {
  const { t } = useI18n();
  const { entries, behind, busyId, confirmDialog, handleRetry, handleDiscard } =
    useQuarantineActions(open, syncEngine);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title={t('scoring.quarantine.title')}
        description={t('scoring.quarantine.intro')}
      >
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">{t('scoring.quarantine.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="quarantine-list">
            {entries.map((entry) => (
              <QuarantineRow
                key={entry.id}
                entry={entry}
                waiting={behind.get(entry.id ?? -1) ?? 0}
                busy={busyId === entry.id}
                onRetry={() => void handleRetry(entry)}
                onDiscard={() => void handleDiscard(entry)}
                t={t}
              />
            ))}
          </ul>
        )}
      </Modal>
      {confirmDialog}
    </>
  );
}
