/**
 * Venues + areas.
 *
 * Venue is an org-level catalogue of physical locations reusable
 * across many events. A venue can host tournaments, workshops, or
 * both (flagged separately). When split into Areas, workshop
 * sessions can sit on a specific area; otherwise sessions link
 * directly to the venue.
 *
 * Lices and workshop_sessions point at venues (and optionally
 * areas) via columns added in migration 0088 — those columns are
 * declared inline on the existing `lices` and `workshopSessions`
 * exports.
 */
import { boolean, integer, pgTable, text, timestamp, uuid, unique } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';

// ── Venues ────────────────────────────────────────────────────────────────────
export const venues = pgTable(
  'venues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    address: text('address'),
    hostsTournament: boolean('hosts_tournament').notNull().default(true),
    hostsWorkshop: boolean('hosts_workshop').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueOrgName: unique('venues_organization_id_name_key').on(table.organizationId, table.name),
  }),
);

// ── Venue areas ───────────────────────────────────────────────────────────────
export const venueAreas = pgTable(
  'venue_areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueVenueName: unique('venue_areas_venue_id_name_key').on(table.venueId, table.name),
  }),
);
