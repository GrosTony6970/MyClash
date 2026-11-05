'use client';

import type { ModerationPhoto, PhotoQueueFilter } from '@myclash/types';
import { SegmentedTabs, useConfirm } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { useScoringTheme } from '../../src/theme/ThemeProvider';
import { EventBanner } from '../../src/components/EventBanner';
import { usePhotoQueue } from '../../src/lib/usePhotoQueue';
import { PhotoTile } from './PhotoTile';

// Literal keys, never a template: a computed t() key is invisible to t-key-references.test.ts.
const EMPTY_KEYS = {
  waiting: 'scoring.photos.emptyWaiting',
  reported: 'scoring.photos.emptyReported',
  all: 'scoring.photos.empty',
} as const satisfies Record<PhotoQueueFilter, string>;

type Queue = ReturnType<typeof usePhotoQueue>;

/**
 * The photo queue for a staff login with the `photos` job (design, "Moderation"): what
 * the Event has received and what the public reported, newest first, with Approve, Keep and
 * Delete. The organiser's admin page holds the mode, the QR poster and the caps; this screen
 * holds the queue alone. Online only.
 */
export default function PhotosPage() {
  const { t } = useI18n();
  const { chromeScope } = useScoringTheme();
  const queue = usePhotoQueue();
  const { confirm, confirmDialog } = useConfirm();

  async function remove(photo: ModerationPhoto) {
    const sure = await confirm({
      title: t('scoring.photos.deleteTitle'),
      description: t('scoring.photos.deleteDescription'),
      confirmLabel: t('scoring.photos.delete'),
      cancelLabel: t('scoring.photos.cancel'),
      danger: true,
    });
    if (sure) await queue.remove(photo);
  }

  return (
    <main data-theme={chromeScope} className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col p-4">
        <EventBanner />
        <div className="mb-3 flex items-center justify-between gap-3">
          <h1 className="font-display text-xl font-bold">{t('scoring.photos.title')}</h1>
          <button
            type="button"
            onClick={queue.refresh}
            className="min-h-[44px] rounded-lg border border-border px-4 text-sm font-semibold"
          >
            {t('scoring.photos.refresh')}
          </button>
        </div>
        <QueueTabs queue={queue} />
        {queue.error && <p className="mt-3 text-sm text-danger">{queue.error}</p>}
        <PhotoList queue={queue} onDelete={(photo) => void remove(photo)} />
      </div>
      {confirmDialog}
    </main>
  );
}

/** Waiting and Reported with their counts, then All. */
function QueueTabs({ queue }: { queue: Queue }) {
  const { t } = useI18n();
  const count = (n: number | undefined) => ({ count: String(n ?? 0) });
  return (
    <SegmentedTabs
      tabs={[
        {
          value: 'waiting' as const,
          label: t('scoring.photos.waiting', count(queue.summary?.waiting)),
        },
        {
          value: 'reported' as const,
          label: t('scoring.photos.reported', count(queue.summary?.reported)),
        },
        { value: 'all' as const, label: t('scoring.photos.all') },
      ]}
      value={queue.filter}
      onChange={queue.setFilter}
      aria-label={t('scoring.photos.tabsLabel')}
    />
  );
}

function PhotoList({
  queue,
  onDelete,
}: {
  queue: Queue;
  onDelete: (photo: ModerationPhoto) => void;
}) {
  const { t } = useI18n();
  if (!queue.summary) return null;
  const { timezone } = queue.summary;
  if (queue.photos.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
        {t(EMPTY_KEYS[queue.filter])}
      </p>
    );
  }
  return (
    <>
      <ul className="mt-3 flex flex-col gap-3">
        {queue.photos.map((photo) => (
          <PhotoTile
            key={photo.id}
            photo={photo}
            timezone={timezone}
            busy={queue.busy}
            onApprove={(p) => void queue.approve(p)}
            onKeep={(p) => void queue.keep(p)}
            onDelete={onDelete}
            onImageError={queue.onImageError}
          />
        ))}
      </ul>
      {queue.next !== null && (
        <button
          type="button"
          disabled={queue.loadingMore}
          onClick={() => void queue.loadMore()}
          className="mt-3 min-h-[44px] rounded-lg border border-border px-4 text-sm font-semibold disabled:opacity-50"
        >
          {t('scoring.photos.loadMore')}
        </button>
      )}
    </>
  );
}
