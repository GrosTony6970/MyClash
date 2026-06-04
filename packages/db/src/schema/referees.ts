/**
 * Referee qualifications, assignments, skill catalog, and per-event availability.
 * Covers: referee_qualifications, referee_assignments, referee_skills, event_referees.
 *
 * Post-migration 0063: the canonical key on all three referee tables
 * is `person_id` (→ global_persons.id). The legacy `user_id` column
 * was dropped; callers that start from a Supabase auth user_id
 * resolve to person_id once via global_persons.claimed_by_user_id
 * and pass person_id throughout. The Drizzle export `fighters`
 * points at the `global_persons` table (it carries the renamed
 * table name from the original fighters→global_persons migration).
 */
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { events, lices } from './events';
import { fighters } from './fighters';
import { matches } from './matches';
import { pools } from './tournaments';

// ── Referee qualifications ────────────────────────────────────────────────────
// Event-scoped: an organizer rates referees for their specific event.
export const refereeQualifications = pgTable('referee_qualifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  personId: uuid('person_id')
    .notNull()
    .references(() => fighters.id, { onDelete: 'cascade' }),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  // arbitre_declarant | arbitre_assesseur | arbitre_table
  rating: integer('rating'), // 1..5, NULL = unrated
  notes: text('notes'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
// UNIQUE(person_id, event_id, role) enforced via migration 0063 (index
// `referee_quals_person_event_role_idx`).

// ── Referee assignments ───────────────────────────────────────────────────────
export const refereeAssignments = pgTable('referee_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  personId: uuid('person_id')
    .notNull()
    .references(() => fighters.id, { onDelete: 'cascade' }),
  scopeType: text('scope_type').notNull(),
  // lice | pool | match
  liceId: uuid('lice_id').references(() => lices.id, { onDelete: 'set null' }),
  poolId: uuid('pool_id').references(() => pools.id, { onDelete: 'set null' }),
  matchId: uuid('match_id').references(() => matches.id, { onDelete: 'set null' }),
  role: text('role'),
  // arbitre_declarant | arbitre_assesseur | arbitre_table
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  status: text('status').notNull().default('assigned'),
  // assigned | confirmed | declined | completed
  autoAssigned: boolean('auto_assigned').notNull().default(false),
  conflictsJsonb: jsonb('conflicts_jsonb'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Referee skills catalog ────────────────────────────────────────────────────
// System skills have event_id = NULL; per-event custom skills have event_id set.
// The CHECK constraint (enforced in SQL migration) ensures exactly one is non-null.
export const refereeSkills = pgTable('referee_skills', {
  id: text('id').primaryKey(),
  eventId: uuid('event_id').references(() => events.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull().default('slate'),
  isSystem: boolean('is_system').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type RefereeSkill = typeof refereeSkills.$inferSelect;
export type NewRefereeSkill = typeof refereeSkills.$inferInsert;

// ── Event referees ────────────────────────────────────────────────────────────
// One row per (event, person) — presence means the person is registered as a
// referee for that event. Availability flags are stored here, independent of
// skills. Post-0063 keys on person_id (→ global_persons.id).
export const eventReferees = pgTable(
  'event_referees',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => fighters.id, { onDelete: 'cascade' }),
    availableAllTournaments: boolean('available_all_tournaments').notNull().default(true),
    availableAllEventDuration: boolean('available_all_event_duration').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.eventId, t.personId] }),
  }),
);

export type EventReferee = typeof eventReferees.$inferSelect;
export type NewEventReferee = typeof eventReferees.$inferInsert;
