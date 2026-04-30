/**
 * Auth & identity tables.
 * Note: auth.users is managed by Supabase GoTrue — we don't define it here.
 * We define the application-level tables that reference auth.users.
 */
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// ── Platform roles ────────────────────────────────────────────────────────────
// Super-admin override. A user with role='super_admin' bypasses all org checks.
export const platformRoles = pgTable('platform_roles', {
  userId: uuid('user_id').primaryKey().notNull(),
  role: text('role').notNull().default('super_admin'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Push subscriptions ────────────────────────────────────────────────────────
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  endpoint: text('endpoint').notNull(),
  p256dhKey: text('p256dh_key').notNull(),
  authKey: text('auth_key').notNull(),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
});

// ── Notification preferences ──────────────────────────────────────────────────
export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id').primaryKey().notNull(),
  matchStartingMinutesBefore: text('match_starting_minutes_before').default('10'),
  workshopStartingMinutesBefore: text('workshop_starting_minutes_before').default('15'),
  refereeStartingMinutesBefore: text('referee_starting_minutes_before').default('10'),
  scheduleChanges: boolean('schedule_changes').notNull().default(true),
  resultsPublished: boolean('results_published').notNull().default(true),
  enabled: boolean('enabled').notNull().default(true),
});
