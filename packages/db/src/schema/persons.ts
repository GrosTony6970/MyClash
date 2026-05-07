/**
 * Persons, guest sessions, follows, and privacy preferences.
 * Persons are the organizer-authoritative roster, scoped to an event.
 */
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { clubs } from './fighters';
import { events } from './events';

// ── Persons ───────────────────────────────────────────────────────────────────
export const persons = pgTable('persons', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  givenName: text('given_name').notNull(),
  familyName: text('family_name').notNull(),
  email: text('email').notNull(),
  clubId: uuid('club_id').references(() => clubs.id, { onDelete: 'set null' }),
  hemaRatingsId: text('hema_ratings_id'),
  dateOfBirth: text('date_of_birth'),
  genderCategory: text('gender_category'),
  notes: text('notes'),
  claimStatus: text('claim_status').notNull().default('unclaimed'),
  // unclaimed | guest_active | claimed
  claimedByUserId: uuid('claimed_by_user_id'),
  globalPersonId: uuid('global_person_id'),
  createdByUserId: uuid('created_by_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
// UNIQUE(event_id, lower(email)) enforced via migration SQL

// ── Guest sessions ────────────────────────────────────────────────────────────
export const guestSessions = pgTable('guest_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  personId: uuid('person_id')
    .notNull()
    .references(() => persons.id, { onDelete: 'cascade' }),
  deviceLabel: text('device_label'),
  ipFirstSeen: text('ip_first_seen'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

// ── Follows ───────────────────────────────────────────────────────────────────
export const follows = pgTable('follows', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  followedPersonId: uuid('followed_person_id')
    .notNull()
    .references(() => persons.id, { onDelete: 'cascade' }),
  followerUserId: uuid('follower_user_id'),
  followerGuestSessionId: uuid('follower_guest_session_id').references(() => guestSessions.id, {
    onDelete: 'cascade',
  }),
  notifyMatchStart: boolean('notify_match_start').notNull().default(true),
  notifyWorkshopStart: boolean('notify_workshop_start').notNull().default(false),
  notifyRefereeStart: boolean('notify_referee_start').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
// CHECK and UNIQUE NULLS NOT DISTINCT enforced via migration SQL

// ── Person privacy preferences ────────────────────────────────────────────────
export const personPrivacy = pgTable('person_privacy', {
  personId: uuid('person_id')
    .primaryKey()
    .references(() => persons.id, { onDelete: 'cascade' }),
  hideWorkshopsPublicly: boolean('hide_workshops_publicly').notNull().default(false),
  allowBeingFollowed: boolean('allow_being_followed').notNull().default(true),
  showRealEmailToFollowers: boolean('show_real_email_to_followers').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const personEmailChangeRequests = pgTable('person_email_change_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  oldEmail: text('old_email').notNull(),
  newEmail: text('new_email').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
