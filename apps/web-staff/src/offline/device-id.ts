/**
 * device-id.ts — a stable, opaque id for THIS browser profile.
 *
 * Names a device, never a person: a tablet at a venue is shared, borrowed and
 * re-lent all day, and several volunteers sign into the same one. So this is
 * deliberately not tied to a staff account — it answers "which slab of glass is
 * still holding refused exchanges", which survives the account being switched.
 *
 * Scoped per browser PROFILE rather than per machine, because the store it
 * describes (IndexedDB) is too: a private window, or a second browser on the
 * same laptop, holds a different quarantine and correctly reports as a
 * different device.
 *
 * Random and meaningless on purpose — no fingerprinting, nothing derived from
 * the hardware.
 */

const STORAGE_KEY = 'myclash.staff.deviceId.v1';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * The id for this profile, minting one on first call.
 *
 * Returns null when storage is unavailable (SSR, or a browser with storage
 * blocked) rather than minting a throwaway per call — an id that changed every
 * heartbeat would fill the table with phantom devices, which is worse than not
 * reporting.
 */
export function getDeviceId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const minted = randomId();
    window.localStorage.setItem(STORAGE_KEY, minted);
    return minted;
  } catch {
    return null;
  }
}
