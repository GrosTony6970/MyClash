'use client';

import { useCallback, useEffect, useState } from 'react';
import { Modal, useConfirm } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { getRejected } from '../offline/outbox';
import type { ExchangeType, RejectedEntry } from '../offline/db';
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
 * `kind`; every reader treats that as 'exchange'.
 */
function entryLabel(entry: RejectedEntry, t: (key: string) => string): string {
  if ((entry.kind ?? 'exchange') === 'penalty') return t('scoring.quarantine.typePenalty');
  return entry.type ? exchangeTypeLabel(entry.type, t) : t('scoring.quarantine.typeUnknown');
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
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setEntries(await getRejected());
  }, []);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async read resolves after the store responds
    void load();
  }, [open, load]);

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
    // Discarding destroys a hit a referee scored. The only legitimate reason is
    // that it has already been re-entered by hand, so the confirmation says so
    // rather than asking a generic "are you sure".
    const confirmed = await confirm({
      title: t('scoring.quarantine.discardTitle'),
      description: t('scoring.quarantine.discardBody'),
      confirmLabel: t('scoring.quarantine.discardConfirm'),
      danger: true,
    });
    if (!confirmed) return;
    await run(entry.id, (id) => syncEngine.discardRejectedEntry(id));
  }

  return { entries, busyId, confirmDialog, handleRetry, handleDiscard };
}

/** One held exchange: what it was, when it was refused, and the way out. */
function QuarantineRow({
  entry,
  busy,
  onRetry,
  onDiscard,
  t,
}: {
  entry: RejectedEntry;
  busy: boolean;
  onRetry: () => void;
  onDiscard: () => void;
  t: (key: string) => string;
}) {
  return (
    <li data-testid="quarantine-row" className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-bold uppercase tracking-wide">{entryLabel(entry, t)}</span>
        <span className="text-xs text-muted">
          {new Date(entry.rejectedAt).toLocaleTimeString()}
        </span>
      </div>
      {/* The server's own words. A 400 carries a real message; only 5xx is
          scrubbed, and a scrubbed one would say so. */}
      <p className="mt-1 text-sm text-danger">{entry.rejectedReason}</p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onRetry}
          className="min-h-[44px] flex-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {t('scoring.quarantine.retry')}
        </button>
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
  const { entries, busyId, confirmDialog, handleRetry, handleDiscard } = useQuarantineActions(
    open,
    syncEngine,
  );

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
