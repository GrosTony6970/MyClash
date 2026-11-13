'use client';

import { useEffect, useRef, useState } from 'react';
import {
  grabFrame,
  isNewScan,
  startCamera,
  stopStream,
  type CameraError,
  type ScanMemory,
} from './camera';
import { loadDecoder, type Decoder } from './decoder';

/** ~8 frames a second. Fast enough to feel instant, slow enough not to cook a cheap tablet. */
const FRAME_INTERVAL_MS = 120;

export interface CameraScanner {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Null while the viewfinder is working. */
  error: CameraError | null;
}

/**
 * Hold the camera open and emit every distinct QR payload it sees.
 *
 * The scanner NEVER stops on a successful read — that is the whole point of the
 * fast lane. A queue of ten people is ten scans with no tap in between, and the
 * caller stacks its confirmations up beside the live viewfinder rather than
 * replacing it.
 *
 * `onToken` is held in a ref so a caller that rebuilds the callback each render
 * does not tear the stream down and put the permission prompt back up mid-queue.
 */
export function useCameraScanner(active: boolean, onToken: (token: string) => void): CameraScanner {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onTokenRef = useLatestRef(onToken);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<CameraError | null>(null);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let opened: MediaStream | null = null;
    // startCamera is state-free, at module scope, and resolves its failures
    // rather than throwing them — so every setState below sits in a `.then()`.
    void startCamera().then((result) => {
      opened = result.stream;
      if (cancelled) {
        if (result.stream) stopStream(result.stream);
        return;
      }
      setError(result.error);
      setStream(result.stream);
    });

    return () => {
      cancelled = true;
      if (opened) stopStream(opened);
    };
  }, [active]);

  useAttachedStream(videoRef, stream);
  useDecodeLoop(videoRef, canvasRef, stream, onTokenRef);

  return { videoRef, canvasRef, error };
}

/**
 * The latest callback, without making it a dependency.
 *
 * Assigned in an effect rather than during render: `react-hooks/refs` refuses a
 * render-phase ref write, and it is right to — under concurrent rendering a
 * discarded render would still have moved the ref.
 */
function useLatestRef<T>(value: T): React.RefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

/** Point the <video> at the stream once both exist. */
function useAttachedStream(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  stream: MediaStream | null,
) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    // Autoplay needs `muted` + `playsInline`, both set on the element; a
    // rejected play() leaves a black viewfinder rather than throwing.
    void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [videoRef, stream]);
}

/** Decode a frame every FRAME_INTERVAL_MS for as long as the stream is live. */
function useDecodeLoop(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  stream: MediaStream | null,
  onTokenRef: React.RefObject<(token: string) => void>,
) {
  useEffect(() => {
    if (!stream) return;

    let decoder: Decoder | null = null;
    let stopped = false;
    const memory: ScanMemory = { token: null, at: 0 };

    // Lazily, once: the decoder is a dynamic import and must not be fetched by
    // surfaces that never scan.
    void loadDecoder().then((loaded) => {
      if (!stopped) decoder = loaded;
    });

    const timer = setInterval(() => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!decoder || !video || !canvas) return;

      const frame = grabFrame(video, canvas);
      if (!frame) return;

      const token = decoder(frame);
      const now = Date.now();
      // A held-still QR decodes on every frame; only a genuinely new read is an
      // event. See isNewScan for why this expires rather than latching.
      if (!token || !isNewScan(token, memory, now)) return;

      memory.token = token;
      memory.at = now;
      onTokenRef.current(token);
    }, FRAME_INTERVAL_MS);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [stream, videoRef, canvasRef, onTokenRef]);
}
