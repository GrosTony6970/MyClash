/**
 * The participant's pass token, on the device that will present it.
 *
 * The API stores only a sha256 of the token, so it CANNOT hand the same one
 * back twice — see migration 0176. The device that was issued a pass therefore
 * keeps the raw value, and re-renders the QR from here on every later visit.
 *
 * That is not a cache for speed. It is what makes the pass work in a sports hall
 * with no signal, which is the only place it is ever presented. A pass that
 * needed a round trip to render would fail at exactly the moment it is used.
 *
 * The trade-off, stated plainly: opening the pass on a SECOND device issues a
 * fresh token and retires this one. Name search at the desk is the fallback, and
 * it is also the desk's primary path — nobody is stranded.
 */

const KEY_PREFIX = 'mc_event_pass:';

export interface StoredPass {
  token: string;
  expiresAt: string | null;
}

function keyFor(eventSlug: string): string {
  return `${KEY_PREFIX}${eventSlug}`;
}

/**
 * Read this device's pass, if it holds one that is still valid.
 *
 * An expired pass is dropped rather than returned: showing a QR that the desk
 * will refuse is worse than showing none, because the fighter finds out with a
 * queue behind them instead of on the way in.
 */
export function readStoredPass(eventSlug: string, now = Date.now()): StoredPass | null {
  if (typeof window === 'undefined') return null;
  const raw = readRaw(keyFor(eventSlug));
  if (!raw) return null;

  const stored = parsePass(raw);
  if (!stored) return null;
  if (stored.expiresAt && new Date(stored.expiresAt).getTime() < now) {
    clearStoredPass(eventSlug);
    return null;
  }
  return stored;
}

/**
 * Safari in private mode THROWS on localStorage access rather than returning
 * null, so every read goes through here. A device that cannot read its storage
 * simply holds no pass, which is true enough and is a worse pass rather than a
 * broken page.
 */
function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStoredPass(eventSlug: string, pass: StoredPass): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(keyFor(eventSlug), JSON.stringify(pass));
  } catch {
    // Out of quota or private mode. The pass still renders this session; it
    // just will not survive a reload, which is a worse pass rather than a
    // broken one.
  }
}

export function clearStoredPass(eventSlug: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(keyFor(eventSlug));
  } catch {
    // See writeStoredPass.
  }
}

/**
 * Parse a stored entry defensively.
 *
 * Anything unrecognised is treated as absent, so a stored shape from an older
 * build makes the device re-issue rather than render a QR built from a
 * malformed value.
 */
function parsePass(raw: string): StoredPass | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredPass>;
    if (typeof parsed.token !== 'string' || parsed.token.length === 0) return null;
    return {
      token: parsed.token,
      expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : null,
    };
  } catch {
    return null;
  }
}
