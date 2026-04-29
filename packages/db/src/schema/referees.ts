/**
 * Referee qualifications and assignments.
 */
import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { events, lices } from './events';
import { matches } from './matches';
import { pools } from './tournaments';

// ── Referee qualifications ────────────────────────────────────────────────────
// Event-scoped: an organizer rates referees for their specific event.
export const refereeQualifications = pgTable('referee_qualifications', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull(),
  eventId:   uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  role:      text('role').notNull(),
  // arbitre_declarant | arbitre_assesseur | arbitre_table
  rating:    integer('rating'),  // 1..5, NULL = unrated
  notes:     text('notes'),
  active:    boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
// UNIQUE(user_id, event_id, role) enforced via migration SQL

// ── Referee assignments ───────────────────────────────────────────────────────
export const refereeAssignments = pgTable('referee_assignments', {
  id:             uuid('id').primaryKey().defaultRandom(),
  eventId:        uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  userId:         uuid('user_id').notNull(),
  scopeType:      text('scope_type').notNull(),
  // lice | pool | match
  liceId:         uuid('lice_id').references(() => lices.id, { onDelete: 'set null' }),
  poolId:         uuid('pool_id').references(() => pools.id, { onDelete: 'set null' }),
  matchId:        uuid('match_id').references(() => matches.id, { onDelete: 'set null' }),
  role:           text('role'),
  // arbitre_declarant | arbitre_assesseur | arbitre_table
  startsAt:       timestamp('starts_at', { withTimezone: true }),
  endsAt:         timestamp('ends_at', { withTimezone: true }),
  status:         text('status').notNull().default('assigned'),
  // assigned | confirmed | declined | completed
  autoAssigned:   boolean('auto_assigned').notNull().default(false),
  conflictsJsonb: jsonb('conflicts_jsonb'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
