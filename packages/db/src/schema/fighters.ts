/**
 * Fighters and clubs — global cross-event identity.
 */
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// ── Clubs ─────────────────────────────────────────────────────────────────────
export const clubs = pgTable('clubs', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  city: text('city'),
  countryCode: text('country_code'),
  website: text('website'),
  logoUrl: text('logo_url'),
  unverified: text('unverified').default('false'), // 'true' when auto-created from CSV
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Fighters ──────────────────────────────────────────────────────────────────
// Global cross-event identity. Created lazily when a Person claims their profile.
export const fighters = pgTable('fighters', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  givenName: text('given_name').notNull(),
  familyName: text('family_name').notNull(),
  clubId: uuid('club_id').references(() => clubs.id, { onDelete: 'set null' }),
  countryCode: text('country_code'),
  hemaRatingsId: text('hema_ratings_id'),
  photoUrl: text('photo_url'),
  bio: text('bio'),
  dateOfBirth: text('date_of_birth'), // stored as ISO date string
  genderCategory: text('gender_category'),
  claimedByUserId: uuid('claimed_by_user_id'),
  mergedIntoFighterId: uuid('merged_into_fighter_id'),
  mergedAt: timestamp('merged_at', { withTimezone: true }),
  mergeRevertedAt: timestamp('merge_reverted_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
