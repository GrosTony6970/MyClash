/**
 * What the tablet does that is not on the screen: a beep and a vibration when
 * time is up, a short vibration when a hit is written (quick win P13; operator,
 * 2026-10-12: no mute setting). The official watches the fighters, not the
 * tablet.
 *
 * Best effort, by design. An iPad has no vibration, and a browser gives no
 * sound to a page nobody has touched yet. Neither is a fault of the bout, so
 * neither says anything: the numeral still turns red, as before.
 */

/** Two pulses: unlike the one short pulse of a hit. */
export const TIME_UP_PATTERN = [200, 100, 200];
/** The pulse of a hit written on the tablet, in ms. */
export const TAP_PULSE_MS = 10;
/** A sound that could not start within this time is not played late. */
const SOUND_STARTS_WITHIN_MS = 1000;

function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined') navigator.vibrate?.(pattern);
  } catch {
    // No vibration on this device.
  }
}

type AudioContextClass = typeof AudioContext;
let audio: AudioContext | null = null;

/** One context for the page: a browser allows only a few. Made at the first sound, never on the server. */
function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Context =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext;
  if (!Context) return null;
  audio ??= new Context();
  return audio;
}

function tone(context: AudioContext): void {
  const oscillator = context.createOscillator();
  const volume = context.createGain();
  oscillator.type = 'square';
  oscillator.frequency.value = 880;
  volume.gain.value = 0.3;
  oscillator.connect(volume);
  volume.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.6);
}

/**
 * A browser keeps a page's sound asleep until somebody touches the page, and
 * wakes it at the next touch. A beep asked for at 0:00 must not sound at that
 * touch, a minute later: it is played only when the sound starts at once.
 */
function beep(): void {
  try {
    const context = audioContext();
    if (!context) return;
    const asked = Date.now();
    void context.resume().then(
      () => {
        if (Date.now() - asked <= SOUND_STARTS_WITHIN_MS) tone(context);
      },
      () => undefined,
    );
  } catch {
    // No sound on this browser.
  }
}

/** Time is up. */
export function timeUpCue(): void {
  vibrate(TIME_UP_PATTERN);
  beep();
}

/** A hit is written on the tablet. */
export function tapCue(): void {
  vibrate(TAP_PULSE_MS);
}
