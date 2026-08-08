'use client';

import { useCallback, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { useScoringTheme } from '../theme/ThemeProvider';
import { PersonRow } from './PersonRow';
import { useCameraScanner } from '../lib/scan/useCameraScanner';
import type { CameraError } from '../lib/scan/camera';
import { classifyScanFailure, scanFailureKey, type ScanOutcome } from '../lib/scan/scan-result';
import type { RosterEntry } from '../lib/useDesk';

interface Props {
  /** Redeem a scanned token. Resolves to the desk row that was just marked. */
  onScan: (token: string) => Promise<RosterEntry>;
  onUndo: (personId: string) => void;
  onClose: () => void;
}

/**
 * The QR fast lane — a lane beside the search box, never a mode the desk lands
 * in.
 *
 * The scanner STAYS LIVE after a successful read and the confirmation stacks up
 * underneath it, so a queue of ten people is ten scans with no tap in between.
 * That is the entire reason this exists; a confirm-then-continue flow would give
 * back most of the speed it buys.
 *
 * Auto-marking is safe here in a way it would not be from the search box: a
 * search hit can be the wrong Marie, a 256-bit token cannot. The face and club
 * still render on every confirmation — the volunteer sees who they admitted,
 * with Undo in reach, rather than being asked to approve it first.
 */
export function ScanOverlay({ onScan, onUndo, onClose }: Props) {
  const { t } = useI18n();
  const { chromeScope } = useScoringTheme();
  const { outcomes, handleToken } = useScanQueue(onScan);
  const { videoRef, canvasRef, error } = useCameraScanner(true, handleToken);

  return (
    <main data-theme={chromeScope} className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-lg border border-border px-4 text-sm font-semibold"
          >
            {t('scoring.desk.backToDesk')}
          </button>
          <h1 className="font-display text-xl font-bold">{t('scoring.scan.title')}</h1>
          <span className="text-sm text-muted">
            {outcomes.filter((outcome) => outcome.kind === 'ok').length}
          </span>
        </div>

        {error ? (
          <CameraUnavailable error={error} onClose={onClose} />
        ) : (
          <Viewfinder videoRef={videoRef} canvasRef={canvasRef} />
        )}

        <OutcomeStack outcomes={outcomes} showEmpty={!error} onUndo={onUndo} />
      </div>
    </main>
  );
}

/**
 * The confirmations, newest first, stacked UNDER a still-live viewfinder.
 *
 * A failure is a row here, never a toast and never a modal: a dialog would stop
 * the line for exactly the person who is already the problem, while the nine
 * people behind them wait.
 */
function OutcomeStack({
  outcomes,
  showEmpty,
  onUndo,
}: {
  outcomes: ScanOutcome[];
  showEmpty: boolean;
  onUndo: (personId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="mt-4 flex-1 space-y-2">
      {outcomes.length === 0 && showEmpty && (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
          {t('scoring.scan.waiting')}
        </p>
      )}
      {outcomes.map((outcome) =>
        outcome.kind === 'ok' ? (
          <PersonRow
            key={outcome.id}
            person={outcome.person}
            actions={
              <button
                type="button"
                onClick={() => onUndo(outcome.person.personId)}
                className="min-h-[44px] rounded-lg border border-border px-4 text-sm font-semibold"
              >
                {t('scoring.desk.undo')}
              </button>
            }
          />
        ) : (
          <p
            key={outcome.id}
            role="alert"
            className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger"
          >
            {t(scanFailureKey(outcome.reason))}
          </p>
        ),
      )}
    </div>
  );
}

/**
 * The stack of scans, newest first.
 *
 * Two things here are load-bearing. `inFlight` stops the same pass being
 * redeemed twice while its request is still open — the time-based suppression in
 * the decoder handles a held-still QR, but a slow venue network can outlast it.
 * And the stack is capped, because a morning's worth of confirmations on a cheap
 * tablet is a scroll container nobody reads and a render cost everybody pays;
 * Undo is only ever wanted on the last few.
 */
const VISIBLE_OUTCOMES = 8;

function useScanQueue(onScan: (token: string) => Promise<RosterEntry>) {
  const [outcomes, setOutcomes] = useState<ScanOutcome[]>([]);
  const nextId = useRef(0);
  const inFlight = useRef(new Set<string>());

  const handleToken = useCallback(
    (token: string) => {
      if (inFlight.current.has(token)) return;
      inFlight.current.add(token);
      const id = (nextId.current += 1);

      const push = (outcome: ScanOutcome) =>
        setOutcomes((prev) => [outcome, ...prev].slice(0, VISIBLE_OUTCOMES));

      void onScan(token)
        .then((person) => push({ kind: 'ok', id, person }))
        .catch((err: unknown) => push({ kind: 'error', id, reason: classifyScanFailure(err) }))
        .finally(() => {
          inFlight.current.delete(token);
        });
    },
    [onScan],
  );

  return { outcomes, handleToken };
}

function Viewfinder({
  videoRef,
  canvasRef,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}) {
  const { t } = useI18n();

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-black">
      {/* A live camera preview: no audio track, nothing to caption. */}
      <video
        ref={videoRef}
        muted
        playsInline
        aria-label={t('scoring.scan.viewfinderLabel')}
        className="aspect-video w-full object-cover"
      />
      {/* Off-screen scratch surface the decoder reads frames from. */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

/**
 * Every way the camera can refuse, said in terms a volunteer can act on.
 *
 * `insecure` is its own state rather than folded into a generic failure because
 * of how it presents: on an untrusted certificate the browser omits
 * `mediaDevices` entirely, so the page looks fine and the scanner simply never
 * starts. Telling someone to "allow camera access" then sends them hunting
 * through a permission dialog that will never appear.
 *
 * Every branch offers the way back to the search box, which is the desk's
 * primary path and always works.
 */
function CameraUnavailable({ error, onClose }: { error: CameraError; onClose: () => void }) {
  const { t } = useI18n();

  return (
    <div className="rounded-xl border border-dashed border-border p-6 text-center">
      <p className="text-sm font-semibold text-foreground">{t(cameraErrorKey(error))}</p>
      <p className="mt-2 text-sm text-muted">{t('scoring.scan.cameraFallback')}</p>
      <button
        type="button"
        onClick={onClose}
        className="mt-4 min-h-[44px] rounded-lg bg-accent px-5 text-sm font-bold text-accent-foreground"
      >
        {t('scoring.scan.useSearch')}
      </button>
    </div>
  );
}

/** Literal keys, one per state — never assembled from a template. */
function cameraErrorKey(error: CameraError): string {
  switch (error) {
    case 'insecure':
      return 'scoring.scan.cameraInsecure';
    case 'denied':
      return 'scoring.scan.cameraDenied';
    case 'no_camera':
      return 'scoring.scan.cameraMissing';
    case 'busy':
      return 'scoring.scan.cameraBusy';
    case 'failed':
      return 'scoring.scan.cameraFailed';
  }
}
