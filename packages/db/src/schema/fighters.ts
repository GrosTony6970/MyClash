/**
 * Fighters and clubs — global cross-event identity.
 */
import {
  type AnyPgColumn,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// ── Clubs ─────────────────────────────────────────────────────────────────────
export const clubs = pgTable('clubs', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  city: text('city'),
  countryCode: text('country_code'),
  website: text('website'),
  logoUrl: text('logo_url'),
  abbreviation: text('abbreviation'),
  unverified: text('unverified').default('false'), // 'true' when auto-created from CSV
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Global Persons ────────────────────────────────────────────────────────────
// Global cross-event identity (renamed from fighters). Role flags allow overlap.
export const fighters = pgTable('global_persons', {
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
  alias: text('alias'), // nickname shown in italic grey below the name
  websiteUrl: text('website_url'),
  instagramUrl: text('instagram_url'),
  youtubeUrl: text('youtube_url'),
  practicingSinceYear: smallint('practicing_since_year'), // year HEMA practice began
  publicVisibility: jsonb('public_visibility').notNull().default({}), // per-field { key: boolean }
  dateOfBirth: text('date_of_birth'), // stored as ISO date string
  genderCategory: text('gender_category'),
  claimedByUserId: uuid('claimed_by_user_id'),
  isFighter: text('is_fighter'),
  isReferee: text('is_referee'),
  isWorkshopParticipant: text('is_workshop_participant'),
  isInstructor: text('is_instructor'),
  mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => fighters.id, {
    onDelete: 'set null',
  }),
  mergedAt: timestamp('merged_at', { withTimezone: true }),
  mergeRevertedAt: timestamp('merge_reverted_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
