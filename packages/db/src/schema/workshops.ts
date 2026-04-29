/**
 * Workshops, sessions, instructors, and enrollments.
 * Workshops are scoped to an Event (not a Tournament).
 */
import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { lices, events } from './events';
import { fighters } from './fighters';

// ── Workshops ─────────────────────────────────────────────────────────────────
export const workshops = pgTable('workshops', {
  id:               uuid('id').primaryKey().defaultRandom(),
  eventId:          uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  slug:             text('slug').notNull(),
  title:            text('title').notNull(),
  shortDescription: text('short_description'),
  descriptionMd:    text('description_md'),
  language:         text('language').notNull().default('fr'),
  // en | fr | both
  level:            text('level').notNull().default('all'),
  // beginner | intermediate | advanced | all
  prerequisites:    text('prerequisites'),
  capacity:         integer('capacity'),
  coverImageUrl:    text('cover_image_url'),
  category:         text('category'),
  status:           text('status').notNull().default('draft'),
  // draft | published | cancelled
  sortOrder:        integer('sort_order').notNull().default(0),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Workshop instructors ──────────────────────────────────────────────────────
export const workshopInstructors = pgTable('workshop_instructors', {
  id:          uuid('id').primaryKey().defaultRandom(),
  workshopId:  uuid('workshop_id').notNull().references(() => workshops.id, { onDelete: 'cascade' }),
  fighterId:   uuid('fighter_id').references(() => fighters.id, { onDelete: 'set null' }),
  displayName: text('display_name').notNull(),
  bio:         text('bio'),
  photoUrl:    text('photo_url'),
  affiliation: text('affiliation'),
  sortOrder:   integer('sort_order').notNull().default(0),
});

// ── Workshop sessions ─────────────────────────────────────────────────────────
export const workshopSessions = pgTable('workshop_sessions', {
  id:            uuid('id').primaryKey().defaultRandom(),
  workshopId:    uuid('workshop_id').notNull().references(() => workshops.id, { onDelete: 'cascade' }),
  startsAt:      timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt:        timestamp('ends_at', { withTimezone: true }).notNull(),
  locationLabel: text('location_label'),
  liceId:        uuid('lice_id').references(() => lices.id, { onDelete: 'set null' }),
  notes:         text('notes'),
  status:        text('status').notNull().default('scheduled'),
  // scheduled | running | completed | cancelled
});

// ── Workshop enrollments ──────────────────────────────────────────────────────
export const workshopEnrollments = pgTable('workshop_enrollments', {
  id:                uuid('id').primaryKey().defaultRandom(),
  workshopSessionId: uuid('workshop_session_id').notNull().references(() => workshopSessions.id, { onDelete: 'cascade' }),
  userId:            uuid('user_id').notNull(),
  status:            text('status').notNull().default('intent'),
  // intent | confirmed | waitlisted | cancelled
  position:          integer('position'),
  enrolledAt:        timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
