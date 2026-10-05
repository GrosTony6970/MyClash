'use client';

import type { ReactNode } from 'react';
import { Modal } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';

/**
 * The two confirms of "generate Pools again".
 *
 * The first says the existing Pools and their bouts go. When a bout was fought
 * the server refuses that, and the second names how many: its yes sends the
 * discard, which the server lets the organisation's owner make (ruling 280).
 */
export function RegenerateConfirms({
  askOverwrite,
  foughtAtStake,
  onCancel,
  onOverwrite,
  onDiscard,
}: {
  askOverwrite: boolean;
  /** How many fought bouts would go; null = not asked. */
  foughtAtStake: number | null;
  onCancel: () => void;
  onOverwrite: () => void;
  onDiscard: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <Confirm
        open={askOverwrite}
        title={t('organizer.pools.page.regenerateConfirmTitle')}
        onCancel={onCancel}
        onYes={onOverwrite}
      >
        <p className="text-muted text-sm">{t('organizer.pools.page.regenerateConfirmBody')}</p>
      </Confirm>
      <Confirm
        open={foughtAtStake !== null}
        title={t('organizer.pools.page.regenerateFoughtTitle')}
        onCancel={onCancel}
        onYes={onDiscard}
      >
        <p className="text-danger text-sm font-medium">
          {foughtAtStake === 1
            ? t('organizer.pools.page.regenerateFoughtOne')
            : t('organizer.pools.page.regenerateFoughtMany', { count: foughtAtStake ?? 0 })}
        </p>
      </Confirm>
    </>
  );
}

function Confirm({
  open,
  title,
  onCancel,
  onYes,
  children,
}: {
  open: boolean;
  title: string;
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
            {t('organizer.pools.page.cancel')}
          </button>
          <button
            onClick={onYes}
            className="px-4 py-2 bg-danger hover:bg-danger-hover text-danger-foreground font-semibold rounded-lg text-sm"
          >
            {t('organizer.pools.page.regenerateConfirmYes')}
          </button>
        </>
      }
    >
      <div className="text-center">
        <p className="text-4xl mb-3">⚠️</p>
        {children}
      </div>
    </Modal>
  );
}
