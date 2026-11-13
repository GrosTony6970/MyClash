'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useI18n } from '@myclash/next-i18n/client';
import { Button, Spinner } from '@myclash/ui';
import type { QrCodeState } from './use-qr-code';

/**
 * "My FightBook QR": the code another fighter scans to send me a spar request. It is its own file
 * so `qrcode.react` loads only when the panel opens. The white square keeps the code readable in
 * dark mode.
 */
export default function QrPanel(props: { state: QrCodeState; onClose: () => void }) {
  const { t } = useI18n();
  const { code, failure, retry } = props.state;
  return (
    <section className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground">{t('publicApp.fightBook.qr.show')}</h3>
      {code ? (
        <div className="rounded-xl bg-white p-4">
          <QRCodeSVG value={code} size={240} />
        </div>
      ) : failure ? (
        <>
          <p role="alert" className="text-sm text-danger">
            {failure === 'throttled'
              ? t('publicApp.fightBook.qr.mintThrottled')
              : t('publicApp.fightBook.qr.mintFailed')}
          </p>
          <Button type="button" variant="ghost" onClick={retry}>
            {t('publicApp.fightBook.qr.retry')}
          </Button>
        </>
      ) : (
        <Spinner label={t('common.loading')} />
      )}
      <p className="text-center text-xs text-muted">{t('publicApp.fightBook.qr.showHint')}</p>
      <Button type="button" variant="ghost" onClick={props.onClose}>
        {t('publicApp.fightBook.qr.close')}
      </Button>
    </section>
  );
}
