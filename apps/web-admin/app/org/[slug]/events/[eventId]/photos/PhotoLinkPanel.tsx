'use client';

import { useRef, useState, type RefObject } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { photoSendPath, type PhotoLink } from '@myclash/types';
import { Button, useConfirm, useToast } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { openPrintWindow } from '@/lib/print-window';
import { publicAppUrl } from '@/lib/public-app-url';
import { photoPosterHtml } from './photo-poster';

interface LinkPanelProps {
  eventSlug: string;
  eventName: string;
  link: PhotoLink | null;
  readOnly: boolean;
  onRotate: () => Promise<unknown>;
}

/**
 * The QR code phones scan to send photos, its link, the A4 poster, and New link, which retires
 * every printed code. The link carries the Event's secret in its hash; it is shown here because the
 * poster prints it anyway.
 */
export function PhotoLinkPanel({ eventSlug, eventName, link, readOnly, onRotate }: LinkPanelProps) {
  const { t } = useI18n();
  const qr = useRef<HTMLDivElement>(null);

  if (!link) {
    return (
      <section className="rounded-md border border-border bg-surface p-4 text-sm text-muted">
        {t('organizer.photos.link.loadError')}
      </section>
    );
  }
  const url = `${publicAppUrl()}${photoSendPath(eventSlug, link.token)}`;

  return (
    <section className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4 sm:flex-row">
      {/* Dark on white whatever the theme, or a phone camera will not read it. */}
      <div ref={qr} className="shrink-0 self-start rounded bg-white p-2" data-testid="photo-qr">
        <QRCodeSVG value={url} size={160} />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-bold text-foreground">{t('organizer.photos.link.heading')}</h2>
        <p className="mt-1 text-sm text-muted">{t('organizer.photos.link.description')}</p>
        <p className="mt-2 break-all text-xs text-foreground-secondary">{url}</p>
        <LinkActions
          url={url}
          eventName={eventName}
          qr={qr}
          readOnly={readOnly}
          onRotate={onRotate}
        />
      </div>
    </section>
  );
}

type LinkActionsProps = Pick<LinkPanelProps, 'eventName' | 'readOnly' | 'onRotate'> & {
  url: string;
  qr: RefObject<HTMLDivElement | null>;
};

/** Print the poster, copy the link, retire it (after asking). */
function LinkActions({ url, eventName, qr, readOnly, onRotate }: LinkActionsProps) {
  const { t } = useI18n();
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const { copied, copy } = useCopy(url);

  function print() {
    const labels = {
      title: t('organizer.photos.link.posterTitle', { event: eventName }),
      scan: t('organizer.photos.link.posterScan'),
    };
    printPoster(qr, eventName, url, labels, () =>
      toast.error(t('organizer.printWindow.popupBlocked')),
    );
  }

  async function rotate() {
    const sure = await confirm({
      title: t('organizer.photos.link.newLinkTitle'),
      description: t('organizer.photos.link.newLinkDescription'),
      confirmLabel: t('organizer.photos.link.newLinkConfirm'),
      cancelLabel: t('actions.cancel'),
      danger: true,
    });
    if (sure) await onRotate();
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onClick={print}>
        {t('organizer.photos.link.print')}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => void copy()}>
        {copied ? t('organizer.photos.link.copied') : t('organizer.photos.link.copy')}
      </Button>
      <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => void rotate()}>
        {t('organizer.photos.link.newLink')}
      </Button>
      {confirmDialog}
    </div>
  );
}

/** Prints the poster with the code drawn on screen, so the printed code is the one shown. */
function printPoster(
  qr: RefObject<HTMLDivElement | null>,
  eventName: string,
  address: string,
  labels: { title: string; scan: string },
  onBlocked: () => void,
) {
  const qrSvg = qr.current?.querySelector('svg')?.outerHTML ?? '';
  openPrintWindow(photoPosterHtml({ eventName, qrSvg, address, labels }), onBlocked);
}

/** Copies the link; says "Copied" for a moment. */
function useCopy(url: string) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard refused: the link is on screen and selectable.
    }
  }
  return { copied, copy };
}
