'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@myclash/ui';
import { localeToBcp47 } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';
import { RequestDeletionModal } from '../../_components/RequestDeletionModal';
import { getPublicApiUrl } from '@/lib/api-url';

interface DeletionRequest {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  requesterName: string | null;
  createdAt: string;
}

interface Props {
  eventId: string;
  eventName: string;
  updatedAt?: string | null;
}

export function ArchivedBanner({ eventId, eventName, updatedAt }: Props) {
  const apiUrl = getPublicApiUrl();
  const { t, locale } = useI18n();
  const toast = useToast();

  const [pendingRequest, setPendingRequest] = useState<DeletionRequest | null | undefined>(
    undefined,
  );
  const [showModal, setShowModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(
      `${apiUrl}/api/v1/deletion-requests/active?targetType=event&targetId=${encodeURIComponent(eventId)}`,
      { credentials: 'include' },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data: DeletionRequest | null) => {
        if (!cancelled) setPendingRequest(data);
      })
      .catch(() => {
        if (!cancelled) setPendingRequest(null);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, eventId, refreshKey]);

  async function handleCancelRequest() {
    if (!pendingRequest) return;
    setCancelling(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/deletion-requests/${pendingRequest.id}/cancel`, {
        method: 'PATCH',
        credentials: 'include',
      });
      if (!res.ok) {
        toast.error(t('common.error'));
        return;
      }
      toast.success(t('organizer.deletionRequest.deletionRequestCancelled'));
      setRefreshKey((k) => k + 1);
    } catch {
      toast.error(t('common.error'));
    } finally {
      setCancelling(false);
    }
  }

  // Still loading pending request info — show basic banner
  if (pendingRequest === undefined) {
    return (
      <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-3 text-sm text-yellow-800">
        {t('organizer.deletionRequest.archivedBannerCopy')}
      </div>
    );
  }

  const formattedArchivedDate = (() => {
    const raw = updatedAt;
    if (!raw) return null;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString(localeToBcp47(locale));
  })();

  if (pendingRequest) {
    const reqDate = (() => {
      const d = new Date(pendingRequest.createdAt);
      return isNaN(d.getTime())
        ? pendingRequest.createdAt
        : d.toLocaleDateString(localeToBcp47(locale));
    })();
    return (
      <div className="bg-orange-50 border-b border-orange-200 px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
        <span className="text-sm text-orange-800">
          {t('organizer.deletionRequest.archivedBannerPendingCopy', {
            requester: pendingRequest.requesterName ?? 'Unknown',
            date: reqDate,
          })}
        </span>
        <button
          onClick={() => void handleCancelRequest()}
          disabled={cancelling}
          className="text-xs font-semibold text-orange-700 border border-orange-300 rounded px-3 py-1.5 hover:bg-orange-100 disabled:opacity-50 whitespace-nowrap"
        >
          {cancelling ? t('common.saving') : t('organizer.deletionRequest.cancelRequest')}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
        <span className="text-sm text-yellow-800">
          {t('organizer.deletionRequest.archivedBannerCopy')}
          {formattedArchivedDate && (
            <span className="ml-2 text-yellow-600 text-xs">
              {t('organizer.deletionRequest.archivedLastArchivedOn', {
                date: formattedArchivedDate,
              })}
            </span>
          )}
        </span>
        <button
          onClick={() => setShowModal(true)}
          className="text-xs font-semibold text-yellow-800 border border-yellow-400 rounded px-3 py-1.5 hover:bg-yellow-100 whitespace-nowrap"
        >
          {t('organizer.deletionRequest.archivedBannerCta')}
        </button>
      </div>

      {showModal && (
        <RequestDeletionModal
          targetType="event"
          targetId={eventId}
          targetLabel={eventName}
          onSuccess={() => {
            setShowModal(false);
            setRefreshKey((k) => k + 1);
          }}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
