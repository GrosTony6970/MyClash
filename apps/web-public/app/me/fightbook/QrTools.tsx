'use client';

import { lazy, Suspense, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import type { FightBookEvent } from '@myclash/types';
import { Button, Spinner } from '@myclash/ui';
import { useQrCode } from './use-qr-code';

// Each view loads on first use: the camera decoder only for the scan, `qrcode.react` only for the
// panel. Neither is in the page's first load.
const QrPanel = lazy(() => import('./QrPanel'));
const QrScan = lazy(() => import('./QrScan'));

type View = 'none' | 'show' | 'scan';

/**
 * "My FightBook QR" and "Scan a FightBook QR", on the Find tab. The QR works anywhere, so the two
 * buttons need no Event. The scan form offers the Events with a day today. A scan sends a spar
 * request, so it tells the page (`onSent`) and My spars shows it. Closing the scan view drops its
 * form: the next opening starts fresh.
 */
export function QrTools(props: {
  apiUrl: string;
  events: FightBookEvent[];
  catalog: string[];
  onSent: () => void;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<View>('none');
  const code = useQrCode(props.apiUrl, view === 'show');
  const close = () => setView('none');
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="ghost" onClick={() => setView('show')}>
          {t('publicApp.fightBook.qr.show')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setView('scan')}>
          {t('publicApp.fightBook.qr.scan')}
        </Button>
      </div>
      <Suspense fallback={<Spinner label={t('common.loading')} />}>
        {view === 'show' ? <QrPanel state={code} onClose={close} /> : null}
        {view === 'scan' ? (
          <QrScan
            apiUrl={props.apiUrl}
            events={props.events.filter((e) => e.today !== null)}
            catalog={props.catalog}
            onSent={props.onSent}
            onClose={close}
          />
        ) : null}
      </Suspense>
    </section>
  );
}
