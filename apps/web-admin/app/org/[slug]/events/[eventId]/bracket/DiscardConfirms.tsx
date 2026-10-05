'use client';

import type { ReactNode } from 'react';
import { Modal } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';

/**
 * A door of the bracket page that the server refused over fought bouts, with
 * the count the SERVER found (ruling 285).
 */
export interface FoughtAsk {
  door: 'regenerate' | 'delete';
  count: number;
}

/** "Regenerate bracket?", with the fought bouts this page knows of. */
export function RegenerateConfirm({
  open,
  playedMatchCount,
  onCancel,
  onYes,
}: {
  open: boolean;
  playedMatchCount: number;
  onCancel: () => void;
  onYes: () => void;
}) {
  const { t } = useI18n();
  return (
    <Confirm
      open={open}
      title={t('organizer.bracketPage.regenerateConfirmTitle')}
      yes={t('organizer.bracketPage.regenerateConfirmYes')}
      onCancel={onCancel}
      onYes={onYes}
    >
      <p className="text-muted text-sm mb-3">{t('organizer.bracketPage.regenerateConfirmBody')}</p>
      {/* The number that turns an abstract warning into a decision. A
          bracket with nothing fought in it costs nothing to redraw. */}
      {playedMatchCount > 0 && <FoughtSentence count={playedMatchCount} />}
    </Confirm>
  );
}

/**
 * The confirm on the server's count.
 *
 * The page counts fought bouts from what it last read, and a bout can start
 * after that. So the page never says the discard on its own count: the server
 * refuses the regenerate or the delete and sends its count, this confirm names
 * it, and its yes sends the discard WITH that count (ruling 288), which the
 * server lets the organisation's owner make. A bout more by then, and the
 * server refuses again: the confirm comes back with the new count.
 */
export function FoughtBoutsConfirm({
  ask,
  onCancel,
  doors,
}: {
  ask: FoughtAsk | null;
  onCancel: () => void;
  /** What a yes does at each door, handed the count this confirm named. */
  doors: Record<FoughtAsk['door'], (count: number) => unknown>;
}) {
  const { t } = useI18n();
  return (
    <Confirm
      open={ask !== null}
      title={t('organizer.bracketPage.foughtConfirmTitle')}
      yes={
        ask?.door === 'delete'
          ? t('organizer.bracketPage.deleteButton')
          : t('organizer.bracketPage.regenerateConfirmYes')
      }
      onCancel={onCancel}
      onYes={() => ask && void doors[ask.door](ask.count)}
    >
      <FoughtSentence count={ask?.count ?? 0} />
    </Confirm>
  );
}

function FoughtSentence({ count }: { count: number }) {
  const { t } = useI18n();
  return (
    <p className="text-danger text-sm font-medium mb-5">
      {count === 1
        ? t('organizer.bracketPage.regenerateConfirmPlayedOne')
        : t('organizer.bracketPage.regenerateConfirmPlayedMany', { count })}
    </p>
  );
}

function Confirm({
  open,
  title,
  yes,
  onCancel,
  onYes,
  children,
}: {
  open: boolean;
  title: string;
  yes: string;
  onCancel: () => void;
  onYes: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Modal
      open={open}
      onClose={onCancel}
      size="sm"
      title={title}
      footer={
        <>
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-border rounded-lg text-sm text-foreground-secondary hover:bg-background"
          >
            {t('organizer.bracketPage.cancel')}
          </button>
          <button
            onClick={onYes}
            className="px-4 py-2 bg-danger hover:bg-danger-hover text-danger-foreground font-semibold rounded-lg text-sm"
          >
            {yes}
          </button>
        </>
      }
    >
      <p className="text-4xl mb-3">⚠️</p>
      {children}
    </Modal>
  );
}
