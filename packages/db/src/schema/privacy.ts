/**
 * Privacy — GDPR erasure receipts, data-retention policy, and the record of
 * who agreed to which published version of the terms and privacy policy.
 *
 * `erasure_log` and `data_retention_settings` are service-role only (RLS
 * enabled, no policies) — see migration 0161. `legal_acceptances` adds an
 * owner-read policy — see migration 0166.
 */
import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Art. 5(2) accountability: records THAT an erasure happened, never WHO it
 * happened to. `subjectHash` is sha256 of the deleted auth uid — enough to
 * answer "was this account erased, and when" if the person asks again, without
 * retaining an identifier for someone who asked to be forgotten.
 */
export const erasureLog = pgTable('erasure_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  subjectHash: text('subject_hash').notNull(),
  kind: text('kind').notNull().default('account_deletion'),
  // account_deletion | admin_anonymisation
  redactedTables: jsonb('redacted_tables').notNull().default({}),
  /**
   * sha256 of the slug an anonymisation rotated away from, letting the old
   * public URL answer 410 Gone. The slug itself is not stored: it contains the
   * person's name, which is exactly what the anonymisation removed. NULL for
   * ordinary account deletion, which does not rotate the slug.
   */
  previousSlugHash: text('previous_slug_hash'),
  executedAt: timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Singleton config row driving the retention worker. 0 means "keep forever".
 *
 * `auditLogDays` defaults to 0 ON PURPOSE — the audit log is a governance
 * record as much as personal data, so PII inside it is handled by
 * redaction-on-erasure rather than by sweeping rows about people who never
 * asked for erasure.
 */
export const dataRetentionSettings = pgTable('data_retention_settings', {
  settingKey: text('setting_key').primaryKey().default('default'),
  enabled: boolean('enabled').notNull().default(true),
  guestSessionDays: integer('guest_session_days').notNull().default(90),
  aiUsageLogDays: integer('ai_usage_log_days').notNull().default(365),
  broadcastRecipientDays: integer('broadcast_recipient_days').notNull().default(365),
  auditLogDays: integer('audit_log_days').notNull().default(0),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastRunRemoved: jsonb('last_run_removed').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
});

/**
 * Append-only evidence that a subject agreed to a specific published version of
 * a document. Exactly one of `userId` / `guestSessionId` is set (CHECK in 0166).
 *
 * Re-acceptance INSERTS; nothing here is ever updated. `version` is the
 * document's published "Last updated" date — the current value lives in
 * `LEGAL_POLICIES` (`@myclash/types`), which is what makes a stale acceptance
 * detectable.
 */
export const legalAcceptances = pgTable('legal_acceptances', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  guestSessionId: uuid('guest_session_id'),
  /** 'terms' | 'privacy' — mirrors LEGAL_DOCUMENT_KINDS. */
  documentKind: text('document_kind').notNull(),
  version: text('version').notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
  ip: text('ip'),
  userAgent: text('user_agent'),
});
