/**
 * audit-log.ts — one writer for `audit_log`, masking personal values on the way in.
 *
 * WHY THIS EXISTS: ~16 services each hand-rolled their own insert, and payloads
 * are free-form JSONB. Three sites in admin-users.service wrote a user's raw
 * email; person-email-change masked its own by hand, proving the concern was
 * understood but not enforced anywhere. Personal data was landing in a
 * governance record that outlives the account it describes.
 *
 * MASK, DON'T SCRUB. An audit row reading "email changed from [redacted] to
 * [redacted]" cannot answer the question an auditor actually asks. `j***@e***`
 * still shows that a value changed and roughly what it was, which is the same
 * trade person-email-change already chose.
 *
 * Two layers, deliberately different:
 *   - THIS FILE masks at WRITE time, so raw PII never enters the table.
 *   - `modules/privacy/erasure-redaction#scrubPii` fully redacts at ERASURE
 *     time, when the person has asked to be forgotten and audit value no longer
 *     outweighs their right. Its key list is broader on purpose.
 *
 * NAMES ARE NOT MASKED, here or there. Published competition results are a
 * public record and keep the competitor's name (GDPR Art. 17(3)); masking it in
 * an internal governance record while printing it on a bracket would be
 * incoherent.
 */

/**
 * Structural minimum, not `SupabaseClient`: ArchiveService restores through a
 * caller-supplied client so a dry run can target a scratch database, and its
 * chain type is its own. Typing the parameter by shape accepts both and makes
 * the helper trivially mockable.
 */
export interface AuditCapableClient {
  from(table: string): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
  };
}

export interface AuditEntry {
  /** NULL for cron/system actors — never a 'system' sentinel string. */
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  payload?: unknown;
  /**
   * Override the row timestamp. Omit and the column defaults to now().
   *
   * Batch writers set this so every row from one run shares an instant and the
   * batch can be grouped by it — event-archive.worker is the one that does.
   */
  createdAt?: string;
}

/** Bounds the recursive walk against a pathological payload. */
const MAX_DEPTH = 8;

/**
 * Per-key masking. A key matches when its lowercased name ENDS WITH one of
 * these, so `email`, `old_email`, `target_email` and `contactEmail` all hit the
 * same rule without enumerating every caller's spelling.
 *
 * Free text (`notes`, `bio`) is deliberately absent: nothing writes it into a
 * payload today, and masking prose to `***` records nothing an auditor can use.
 * Erasure-time scrubbing still covers it if that ever changes.
 */
const MASKERS: readonly [suffix: string, mask: (value: string) => string][] = [
  ['email', maskEmail],
  ['phone', maskTail],
  ['phone_number', maskTail],
  ['date_of_birth', maskDate],
  ['dob', maskDate],
  ['ip', maskIp],
  ['ip_first_seen', maskIp],
  ['user_agent', maskUserAgent],
];

function maskerFor(key: string): ((value: string) => string) | null {
  const lower = key.toLowerCase();
  for (const [suffix, mask] of MASKERS) {
    if (lower === suffix || lower.endsWith(`_${suffix}`)) return mask;
  }
  // camelCase spellings (targetEmail, dateOfBirth) — normalise and retry.
  const snake = lower.replace(/([a-z])([A-Z])/g, '$1_$2');
  if (snake !== lower) return maskerFor(snake);
  return null;
}

/** `jean.dupont@example.com` → `j***@e***`. The shape person-email-change set. */
export function maskEmail(value: string): string {
  if (!value) return '';
  const [local = '', domain = ''] = value.split('@');
  const domainHead = domain.split('.')[0] ?? '';
  return `${local.slice(0, 1)}***@${domainHead.slice(0, 1)}***`;
}

/** Keep the last two characters, enough to confirm which number changed. */
function maskTail(value: string): string {
  return value.length <= 2 ? '***' : `***${value.slice(-2)}`;
}

/** `1990-04-17` → `1990-**-**`. The year is the part with audit value. */
function maskDate(value: string): string {
  const year = /^(\d{4})/.exec(value)?.[1];
  return year ? `${year}-**-**` : '***';
}

/** Keep the network prefix, drop the host: `203.0.113.42` → `203.0.*.*`. */
function maskIp(value: string): string {
  const parts = value.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
  // IPv6 or something unexpected — keep only the first group.
  return `${value.split(':')[0] ?? ''}:***`;
}

/** Browser family only; the full string is a fingerprint. */
function maskUserAgent(value: string): string {
  return value.split(/[\s/]/)[0] ?? '***';
}

/**
 * Mask every personal value in a payload, at any depth, preserving its shape.
 *
 * Only string leaves are masked. A key whose value is a number or object is left
 * alone: `date_of_birth: null` stays null rather than becoming the string '***'.
 */
export function maskAuditPayload(payload: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return payload;
  if (Array.isArray(payload)) return payload.map((item) => maskAuditPayload(item, depth + 1));
  if (payload === null || typeof payload !== 'object') return payload;

  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>).map(([key, value]) => {
      const mask = maskerFor(key);
      if (mask && typeof value === 'string') return [key, mask(value)];
      return [key, maskAuditPayload(value, depth + 1)];
    }),
  );
}

/**
 * Insert one audit row with its payload masked.
 *
 * Returns the PostgREST error rather than throwing, because callers disagree
 * about severity on purpose: most treat a failed audit write as best-effort (an
 * audit failure must never fail the mutation it describes), while merge.service
 * throws — losing the trail of a destructive identity merge is not acceptable
 * there. Each caller keeps its own decision.
 */
export async function insertAuditLog(
  supabase: AuditCapableClient,
  entry: AuditEntry,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.from('audit_log').insert({
    actor_user_id: entry.actorUserId,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    payload_json: entry.payload === undefined ? null : maskAuditPayload(entry.payload),
    ...(entry.createdAt ? { created_at: entry.createdAt } : {}),
  });
  return { error: error ? { message: error.message } : null };
}

export const __testing = { maskerFor, maskTail, maskDate, maskIp, maskUserAgent };
