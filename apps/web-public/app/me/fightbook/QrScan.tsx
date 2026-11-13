'use client';

import { useId } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import type { FightBookEvent } from '@myclash/types';
import { Button } from '@myclash/ui';
import { cameraErrorKey, useCameraScanner, type CameraScanner } from '@myclash/ui/scan';
import { Field, inputClass, WeaponBoxes } from '@/components/fightbook/AskSparFields';
import { useQrScan, type ScanPhase } from './use-qr-scan';

type Scan = ReturnType<typeof useQrScan>;

function WhereFields(props: { events: FightBookEvent[]; scan: Scan }) {
  const { t } = useI18n();
  const id = useId();
  const { scan, events } = props;
  return (
    <>
      {events.length > 0 ? (
        <Field label={t('publicApp.fightBook.qr.where')} htmlFor={`${id}-where`}>
          <select
            id={`${id}-where`}
            className={inputClass}
            value={scan.where}
            onChange={(e) => scan.setWhere(e.target.value)}
          >
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
            <option value="">{t('publicApp.fightBook.qr.elsewhere')}</option>
          </select>
        </Field>
      ) : null}
      {scan.where === '' ? (
        <Field label={t('publicApp.fightBook.qr.place')} htmlFor={`${id}-place`}>
          <input
            id={`${id}-place`}
            type="text"
            maxLength={200}
            className={inputClass}
            value={scan.place}
            onChange={(e) => scan.setPlace(e.target.value)}
          />
        </Field>
      ) : null}
    </>
  );
}

function Viewfinder(props: { camera: CameraScanner }) {
  const { t } = useI18n();
  const { videoRef, canvasRef, error } = props.camera;
  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {t(cameraErrorKey(error))}
      </p>
    );
  }
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-black">
      {/* A live camera preview: no audio track, nothing to caption. */}
      <video
        ref={videoRef}
        muted
        playsInline
        aria-label={t('publicApp.fightBook.qr.pointAt')}
        className="aspect-video w-full object-cover"
      />
      {/* Off-screen scratch surface the decoder reads frames from. */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

/** After the send: sending, the one answer a scan gets, or a refusal with a way to scan again. */
function Outcome(props: { phase: ScanPhase; onAgain: () => void }) {
  const { t } = useI18n();
  const { phase } = props;
  if (phase.kind === 'sending') {
    return (
      <p role="status" className="text-sm text-muted">
        {t('publicApp.fightBook.qr.sending')}
      </p>
    );
  }
  if (phase.kind === 'sent') {
    return (
      <p role="status" className="text-sm text-foreground">
        {t('publicApp.fightBook.qr.sent')}
      </p>
    );
  }
  if (phase.kind !== 'refused') return null;
  return (
    <>
      <p role="alert" className="text-sm text-danger">
        {phase.message}
      </p>
      <Button type="button" onClick={props.onAgain}>
        {t('publicApp.fightBook.qr.again')}
      </Button>
    </>
  );
}

/**
 * Scan another fighter's FightBook QR: weapons and where first, then the camera, which sends the
 * first `fb:` code it reads and stops. The camera is held, and shown, only while scanning.
 */
export default function QrScan(props: {
  apiUrl: string;
  events: FightBookEvent[];
  catalog: string[];
  onSent: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const scan = useQrScan(props);
  const { phase } = scan;
  // Active only while scanning: any other phase releases the camera.
  const camera = useCameraScanner(phase.kind === 'scanning', scan.onToken);
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground">
        {t('publicApp.fightBook.qr.scanTitle')}
      </h3>
      {phase.kind === 'form' ? (
        <>
          <WeaponBoxes catalog={props.catalog} picked={scan.weapons} onToggle={scan.toggle} />
          <WhereFields events={props.events} scan={scan} />
          <Button type="button" disabled={!scan.ready} onClick={scan.start}>
            {t('publicApp.fightBook.qr.start')}
          </Button>
        </>
      ) : null}
      {phase.kind === 'scanning' ? (
        <>
          <p className="text-sm text-muted">{t('publicApp.fightBook.qr.pointAt')}</p>
          <Viewfinder camera={camera} />
        </>
      ) : null}
      <Outcome phase={phase} onAgain={scan.start} />
      <Button type="button" variant="ghost" onClick={props.onClose}>
        {t('publicApp.fightBook.qr.close')}
      </Button>
    </section>
  );
}
